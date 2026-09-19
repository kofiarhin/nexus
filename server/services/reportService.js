import { appError } from '../utils/errors.js';
import { sortTasks } from './taskService.js';

/**
 * Traceable reports (PRD section 9).
 *
 * Every figure is computed from current Vault records and carries its sources.
 * An optional narrative from the reasoning provider is returned separately and
 * labelled as a recommendation so facts and generated prose never blend.
 */
export class ReportService {
  constructor({
    taskService,
    projectRepository,
    businessRepository,
    auditService,
    retrievalService,
    provider,
    now = () => new Date()
  }) {
    this.taskService = taskService;
    this.projectRepository = projectRepository;
    this.businessRepository = businessRepository;
    this.auditService = auditService;
    this.retrievalService = retrievalService;
    this.provider = provider;
    this.now = now;
  }

  async #daily() {
    const day = this.now().toISOString().slice(0, 10);
    const { tasks, sources } = await this.taskService.list({ view: 'all' });
    const summary = await this.taskService.summary();

    return {
      type: 'daily',
      date: day,
      facts: {
        ...summary,
        dueToday: sortTasks(tasks.filter((task) => task.dueDate === day)).map((task) => ({
          id: task.id,
          name: task.name,
          priority: task.priority
        })),
        overdue: sortTasks(tasks.filter((task) => task.dueDate && task.dueDate < day && task.status !== 'done')).map(
          (task) => ({ id: task.id, name: task.name, dueDate: task.dueDate })
        )
      },
      sources
    };
  }

  async #weekly() {
    const end = this.now();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 7);
    const startDay = start.toISOString().slice(0, 10);
    const endDay = end.toISOString().slice(0, 10);

    const { tasks, sources } = await this.taskService.list({ view: 'all' });
    const activity = this.auditService.list({ limit: 200 });
    const withinWindow = activity.filter((event) => event.timestamp >= `${startDay}T00:00:00.000Z`);

    return {
      type: 'weekly',
      range: { start: startDay, end: endDay },
      facts: {
        completed: tasks
          .filter((task) => task.status === 'done' && task.completedAt && task.completedAt >= startDay)
          .map((task) => ({ id: task.id, name: task.name, completedAt: task.completedAt })),
        stillOpen: tasks.filter((task) => ['todo', 'in-progress', 'blocked'].includes(task.status)).length,
        mutations: withinWindow.filter((event) => event.result === 'succeeded').length,
        failures: withinWindow.filter((event) => ['failed', 'conflicted'].includes(event.result)).length
      },
      sources
    };
  }

  async #project(projectId) {
    const project = await this.projectRepository.get(projectId);
    if (!project) throw appError('NOT_FOUND', 'Project not found');

    const { tasks, sources } = await this.taskService.list({ projectId });

    return {
      type: 'project',
      project: { id: project.id, name: project.name, lifecycle: project.lifecycle },
      facts: {
        openTasks: tasks.filter((task) => task.status !== 'done').length,
        completedTasks: tasks.filter((task) => task.status === 'done').length,
        openQuestions: project.openQuestions,
        decisions: project.decisions,
        roadmap: project.roadmap
      },
      sources: [...project.sources, ...sources]
    };
  }

  async #business(businessId) {
    const business = await this.businessRepository.get(businessId);
    if (!business) throw appError('NOT_FOUND', 'Business not found');

    const { tasks, sources } = await this.taskService.list({ businessId });

    return {
      type: 'business',
      business: { id: business.id, name: business.name, status: business.status },
      facts: {
        openTasks: tasks.filter((task) => task.status !== 'done').length,
        metrics: business.metrics,
        risks: business.risks,
        blockers: business.blockers,
        goals: business.goals
      },
      sources: [...business.sources, ...sources]
    };
  }

  #activity() {
    const events = this.auditService.list({ limit: 200 });
    return {
      type: 'activity',
      facts: {
        total: events.length,
        succeeded: events.filter((event) => event.result === 'succeeded').length,
        proposed: events.filter((event) => event.result === 'proposed').length,
        rejected: events.filter((event) => event.result === 'rejected').length,
        conflicted: events.filter((event) => event.result === 'conflicted').length,
        failed: events.filter((event) => event.result === 'failed').length
      },
      events: events.slice(0, 50),
      sources: []
    };
  }

  async generate({ type = 'daily', id = null, narrative = false }) {
    let report;
    if (type === 'daily') report = await this.#daily();
    else if (type === 'weekly') report = await this.#weekly();
    else if (type === 'project') report = await this.#project(id);
    else if (type === 'business') report = await this.#business(id);
    else if (type === 'activity') report = this.#activity();
    else throw appError('VALIDATION_ERROR', `Unsupported report type: ${type}`);

    report.generatedAt = this.now().toISOString();
    report.narrative = null;
    report.aiAvailable = this.provider.isConfigured();

    if (!narrative || !this.provider.isConfigured()) return report;

    const context = await this.retrievalService.buildContext({
      scope: { type: 'vault', ids: [] },
      query: `${type} report`
    });

    const result = await this.provider.generateSummary(JSON.stringify(report.facts, null, 2), context.sources, {
      instruction: `Write a concise ${type} report narrative from these deterministic facts. `
        + 'Label any suggestion as a recommendation and cite sources.'
    });

    report.narrative = { text: result.text, citations: result.citations, basis: 'ai-recommendation' };
    return report;
  }
}
