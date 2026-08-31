export async function runInTransaction<T>(work: () => Promise<T>): Promise<T> {
  return work();
}
