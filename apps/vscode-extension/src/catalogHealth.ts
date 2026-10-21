export interface CatalogRenderReport {
  revision: number;
  publicCards: number;
  dedicatedCards: number;
}
/** A renderer acknowledgement proves script/DOM execution, not visual or usability QA. */
export class CatalogHealth {
  revision = 0;
  ready = false;
  report: CatalogRenderReport | undefined;
  private waiters = new Set<() => void>();
  next(): number {
    return ++this.revision;
  }
  accept(report: CatalogRenderReport): boolean {
    if (!this.ready || report.revision !== this.revision) return false;
    this.report = report;
    for (const notify of this.waiters) notify();
    return true;
  }
  reset(): void {
    this.ready = false;
    this.report = undefined;
    this.revision++;
    for (const notify of this.waiters) notify();
  }
  async wait(timeoutMs = 10000): Promise<CatalogRenderReport | undefined> {
    if (this.report?.revision === this.revision) return this.report;
    return new Promise((resolve) => {
      const finish = () => {
        if (!this.ready || this.report?.revision === this.revision) {
          clearTimeout(timer);
          this.waiters.delete(finish);
          resolve(
            this.report?.revision === this.revision ? this.report : undefined,
          );
        }
      };
      const timer = setTimeout(() => {
        this.waiters.delete(finish);
        resolve(undefined);
      }, timeoutMs);
      this.waiters.add(finish);
    });
  }
}
