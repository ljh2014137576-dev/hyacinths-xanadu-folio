import {
  existsSync,
  promises as fs,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import ts from '@typescript/typescript6';
import { minimatch } from 'minimatch';

export interface WorkspacePathViolation {
  readonly code: 'WORKSPACE_PATH_ESCAPE' | 'WORKSPACE_SYMLINK_ESCAPE';
  readonly entryName: string;
}

const normalize = (value: string): string => value.split(sep).join('/');

const isContained = (root: string, candidate: string): boolean => {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot));
};

const nearestExistingAncestor = (candidate: string): string => {
  let current = candidate;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
};

const safePattern = (rootDirectory: string, pattern: string, workspaceRoot: string): boolean => {
  const prefix = pattern.split(/[*?]/, 1)[0] ?? '';
  return isContained(workspaceRoot, resolve(rootDirectory, prefix.length === 0 ? '.' : prefix));
};

const typeScriptWildcardPattern = (pattern: string): string => pattern.replaceAll('[', '\\[').replaceAll(']', '\\]');

export class SecureTypeScriptSystem {
  readonly rootPath: string;
  readonly violations: WorkspacePathViolation[] = [];
  private readonly trustedLibRoot: string;
  private projectFiles: readonly string[] = [];
  private prepared = false;
  private readonly violationKeys = new Set<string>();

  constructor(rootPath: string, compilerOptions: ts.CompilerOptions = {}) {
    this.rootPath = realpathSync.native(resolve(rootPath));
    this.trustedLibRoot = realpathSync.native(dirname(ts.getDefaultLibFilePath(compilerOptions)));
  }

  get enumeratedFileCount(): number {
    return this.projectFiles.length;
  }

  get enumeratedProjectRelativePaths(): readonly string[] {
    return this.projectFiles.map((file) => normalize(relative(this.rootPath, file)));
  }

  private record(code: WorkspacePathViolation['code'], candidate: string): void {
    const key = `${code}:${candidate}`;
    if (this.violationKeys.has(key)) return;
    this.violationKeys.add(key);
    this.violations.push({ code, entryName: basename(candidate) || 'workspace entry' });
  }

  private allowedRoot(candidate: string, reportViolation: boolean): string | undefined {
    const absolute = resolve(candidate);
    if (isContained(this.rootPath, absolute)) return this.rootPath;
    if (isContained(this.trustedLibRoot, absolute)) return this.trustedLibRoot;
    if (reportViolation) this.record('WORKSPACE_PATH_ESCAPE', absolute);
    return undefined;
  }

  private validate(candidate: string, reportViolation = true): string | undefined {
    const absolute = resolve(candidate);
    const allowedRoot = this.allowedRoot(absolute, reportViolation);
    if (allowedRoot === undefined) return undefined;
    const ancestor = nearestExistingAncestor(absolute);
    let realAncestor: string;
    try {
      realAncestor = realpathSync.native(ancestor);
    } catch {
      return undefined;
    }
    if (!isContained(allowedRoot, realAncestor)) {
      if (reportViolation) this.record('WORKSPACE_SYMLINK_ESCAPE', absolute);
      return undefined;
    }
    if (existsSync(absolute)) {
      const realCandidate = realpathSync.native(absolute);
      if (!isContained(allowedRoot, realCandidate)) {
        if (reportViolation) this.record('WORKSPACE_SYMLINK_ESCAPE', absolute);
        return undefined;
      }
      return realCandidate;
    }
    return absolute;
  }

  async prepareProjectFileIndex(
    signal: AbortSignal,
    onProgress: (completedFiles: number) => void = () => undefined,
    configuredExcludedDirectories: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    if (this.prepared) return;
    const excludedDirectories = new Set(['.git', '.tmp', 'node_modules', ...configuredExcludedDirectories]);
    const files: string[] = [];
    const queue: { readonly logicalPath: string; readonly ancestry: ReadonlySet<string> }[] = [{
      logicalPath: this.rootPath,
      ancestry: new Set([this.rootPath]),
    }];
    let processedEntries = 0;
    while (queue.length > 0) {
      if (signal.aborted) throw new Error('Workspace enumeration cancelled');
      const directory = queue.shift();
      if (directory === undefined) continue;
      const entries = await fs.readdir(directory.logicalPath, { withFileTypes: true });
      for (const entry of entries) {
        if (signal.aborted) throw new Error('Workspace enumeration cancelled');
        const candidate = resolve(directory.logicalPath, entry.name);
        if (excludedDirectories.has(entry.name) && (entry.isDirectory() || entry.isSymbolicLink())) continue;
        if (entry.isSymbolicLink()) {
          const target = realpathSync.native(candidate);
          if (!isContained(this.rootPath, target)) {
            this.record('WORKSPACE_SYMLINK_ESCAPE', candidate);
            continue;
          }
          const targetDetails = statSync(candidate);
          if (targetDetails.isFile()) files.push(candidate);
          if (targetDetails.isDirectory() && !directory.ancestry.has(target)) {
            queue.push({ logicalPath: candidate, ancestry: new Set([...directory.ancestry, target]) });
          }
          continue;
        }
        if (entry.isDirectory()) {
          const realDirectory = realpathSync.native(candidate);
          if (!directory.ancestry.has(realDirectory)) {
            queue.push({ logicalPath: candidate, ancestry: new Set([...directory.ancestry, realDirectory]) });
          }
        } else if (entry.isFile()) {
          files.push(candidate);
        }
        processedEntries += 1;
        if (processedEntries % 128 === 0) {
          onProgress(files.length);
          await new Promise<void>((resolvePromise) => setImmediate(resolvePromise));
        }
      }
    }
    this.projectFiles = files;
    this.prepared = true;
    onProgress(files.length);
  }

  private expandDirectoryPattern(root: string, pattern: string): string {
    const absolutePattern = isAbsolute(pattern) || /^[A-Za-z]:[\\/]/.test(pattern);
    const normalized = normalize(absolutePattern ? relative(root, pattern) : pattern).replace(/^\.\//, '').replace(/\/$/, '');
    if (/[*?]/.test(normalized)) return normalized;
    const candidate = resolve(root, normalized.length === 0 ? '.' : normalized);
    return this.directoryExists(candidate) ? normalized === '.' || normalized.length === 0 ? '**/*' : `${normalized}/**/*` : normalized;
  }

  readonly fileExists = (fileName: string): boolean => {
    const candidate = this.validate(fileName, false);
    return candidate !== undefined && existsSync(candidate) && statSync(candidate).isFile();
  };

  readonly readFile = (fileName: string): string | undefined => {
    const candidate = this.validate(fileName);
    if (candidate === undefined || !existsSync(candidate) || !statSync(candidate).isFile()) return undefined;
    return readFileSync(candidate, 'utf8');
  };

  readonly directoryExists = (directoryName: string): boolean => {
    const candidate = this.validate(directoryName, false);
    return candidate !== undefined && existsSync(candidate) && statSync(candidate).isDirectory();
  };

  readonly realpath = (path: string): string => this.validate(path, false) ?? resolve(path);

  readonly getDirectories = (directoryName: string): readonly string[] => {
    const directory = this.validate(directoryName, false);
    if (directory === undefined || !existsSync(directory) || !statSync(directory).isDirectory()) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isDirectory() || entry.isSymbolicLink()) return [];
      const candidate = this.validate(resolve(directory, entry.name), false);
      return candidate === undefined ? [] : [candidate];
    });
  };

  readonly readDirectory = (
    rootDirectory: string,
    extensions: readonly string[],
    excludes: readonly string[] | undefined,
    includes: readonly string[] | undefined,
    depth?: number,
  ): readonly string[] => {
    const root = this.validate(rootDirectory);
    if (root === undefined) return [];
    const safeIncludes = (includes ?? ['**/*']).filter((pattern) => {
      const safe = safePattern(root, pattern, this.rootPath);
      if (!safe) this.record('WORKSPACE_PATH_ESCAPE', resolve(root, pattern));
      return safe;
    });
    const safeExcludes = (excludes ?? []).filter((pattern) => safePattern(root, pattern, this.rootPath));
    const includePatterns = safeIncludes.map((pattern) => typeScriptWildcardPattern(this.expandDirectoryPattern(root, pattern)));
    const excludePatterns = safeExcludes.map((pattern) => typeScriptWildcardPattern(this.expandDirectoryPattern(root, pattern)));
    return this.projectFiles.filter((file) => {
      if (!isContained(root, file)) return false;
      if (extensions.length > 0 && !extensions.includes(extname(file))) return false;
      const pathFromRoot = normalize(relative(root, file));
      if (depth !== undefined && pathFromRoot.split('/').length - 1 > depth) return false;
      const matchOptions = {
        dot: false,
        nocase: !ts.sys.useCaseSensitiveFileNames,
        nobrace: true,
        noext: true,
        nonegate: true,
        nocomment: true,
      } as const;
      if (!includePatterns.some((pattern) => minimatch(pathFromRoot, pattern, matchOptions))) return false;
      return !excludePatterns.some((pattern) => minimatch(pathFromRoot, pattern, matchOptions));
    });
  };

  createParseConfigHost(): ts.ParseConfigHost {
    return {
      useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
      fileExists: this.fileExists,
      readFile: this.readFile,
      readDirectory: this.readDirectory,
      trace: () => undefined,
    };
  }

  createCompilerHost(options: ts.CompilerOptions): ts.CompilerHost {
    const base = ts.createCompilerHost(options, true);
    return {
      ...base,
      fileExists: this.fileExists,
      readFile: this.readFile,
      directoryExists: this.directoryExists,
      getDirectories: (path) => [...this.getDirectories(path)],
      realpath: this.realpath,
      getCurrentDirectory: () => this.rootPath,
      getSourceFile: (fileName, languageVersion, onError) => {
        const source = this.readFile(fileName);
        if (source === undefined) {
          onError?.('Source file is outside the authorized workspace or missing');
          return undefined;
        }
        const scriptKind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX
          : fileName.endsWith('.jsx') ? ts.ScriptKind.JSX
          : fileName.endsWith('.js') || fileName.endsWith('.mjs') || fileName.endsWith('.cjs') ? ts.ScriptKind.JS
          : fileName.endsWith('.json') ? ts.ScriptKind.JSON
          : ts.ScriptKind.TS;
        return ts.createSourceFile(fileName, source, languageVersion, true, scriptKind);
      },
    };
  }
}
