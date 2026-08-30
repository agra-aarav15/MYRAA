// Myraa Task System — §13-15, §50-52
export const TaskStatus = { PENDING:'pending', PLANNING:'planning', RUNNING:'running', WAITING_CONFIRM:'waiting_confirm', PAUSED:'paused', FAILED:'failed', DONE:'done', CANCELLED:'cancelled' };
export class Task {
  constructor({ id, mission, device='pc', budget={} }) {
    this.id = id || Math.random().toString(36).slice(2,11);
    this.mission = mission;
    this.device = device;
    this.status = TaskStatus.PENDING;
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.checkpoints = [];
    this.budget = { maxRetries:3, maxTimeSec:3600, maxTokens:80000, ...budget };
    this.retries = 0;
  }
  checkpoint(state){ this.checkpoints.push({ ts:new Date().toISOString(), state, status:this.status }); this.updatedAt=new Date().toISOString(); }
}
