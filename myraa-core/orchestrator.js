// Master Orchestrator — §5, maps to §3 loop: intent->risk->plan->delegate->execute->verify->correct
import { Task, TaskStatus } from './task.js';
import { emit } from './eventBus.js';

export class MasterOrchestrator {
  constructor({ toolRegistry, policyEngine, modelRouter, memory }) {
    this.tools = toolRegistry;
    this.policy = policyEngine;
    this.router = modelRouter;
    this.memory = memory;
    this.active = new Map();
  }
  async handle(mission, opts={}){
    const task = new Task({ mission, device: opts.device || 'pc' });
    this.active.set(task.id, task);
    emit('task:started',{ taskId:task.id, mission });
    try {
      // 1. Intent + risk (stub: all NORMAL, DANGEROUS via policy)
      const risk = await this.policy.assess(mission);
      // 2. Plan (stub: single step -> delegate to jarvisMission if available)
      task.status = TaskStatus.PLANNING;
      const plan = await this.plan(mission, risk);
      task.status = TaskStatus.RUNNING;
      // 3. Delegate to specialized agents (stub: sequential tool calls)
      for (const step of plan.steps){
        emit('tool:invoked',{ taskId:task.id, tool: step.tool, args: step.args });
        const res = await this.tools.call(step.tool, step.args);
        emit('tool:completed',{ taskId:task.id, tool: step.tool, result: res.result?.slice(0,200) });
        task.checkpoint({ step: step.tool, ok: res.ok });
        if(!res.ok && task.retries < task.budget.maxRetries){
          task.retries++; await this.correct(step, res);
        }
      }
      task.status = TaskStatus.DONE;
      emit('task:completed',{ taskId:task.id, result: plan.summary });
      return { ok:true, taskId:task.id, result: plan.summary };
    } catch(e){
      task.status = TaskStatus.FAILED;
      emit('error',{ taskId:task.id, error:e.message });
      return { ok:false, error:e.message };
    }
  }
  async plan(mission, risk){
    const lower = mission.toLowerCase();
    const steps=[];
    if(/snake|ladder/.test(lower)) steps.push({ tool:'createSnakeLadderGame', args:{ path:'F:\\snake-ladder' }});
    if(/status|today/.test(lower)) steps.push({ tool:'getTodayStatus', args:{}});
    if(steps.length===0) steps.push({ tool:'jarvisMission', args:{ mission }});
    return { steps, summary: `Planned ${steps.length} step(s) for: ${mission}` };
  }
  async correct(step, res){ /* §15 self-correction stub */ }
}
