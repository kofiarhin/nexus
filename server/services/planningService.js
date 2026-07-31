import { VAULT_PATHS } from '../config/policy.js';
import { sortTasks } from './taskService.js';

const PRIORITY_WEIGHT = { critical: 40, high: 30, medium: 15, low: 5 };

/**
 * Deterministic daily planning (PRD "Daily planning").
 *
 * Ranking, reasons, and citations are computed from real Vault records. The
 * reasoning provider may add a narrative on top, but never replaces or reorders
 * the deterministic recommendation set.
 */
export class PlanningService {
  constructor({
    taskRepository,
    projectRepository,
    businessRepository,
    dailyRepository,
    retrievalService,
    auditService,
    provider,
    now = () => new Date()
  }) {
    this.taskRepository = taskRepository;
    this.projectRepository = projectRepository;
    this.businessRepository = businessRepository;
    this.dailyRepository = dailyRepository;
    this.retrievalService = retrievalService;
    this.auditService = auditService;
    this.provider = provider;
    this.now = now;
  }

  #score(task, day) {
    let score = PRIORITY_WEIGHT[task.priority] ?? 10;
    const reasons = [];

    if (task.dueDate && task.dueDate < day) {
      score += 60;
      reasons.push(`Overdue since ${task.dueDate}`);
    } else if (task.dueDate === day) {
      score += 45;
      reasons.push('Due today');
    } else if (task.dueDate) {
      score += 10;
      reasons.push(`Due ${task.dueDate}`);
    }

    if (task.priority === 'critical' || task.priority === 'high') {
      reasons.push(`Priority is ${task.priority}`);
    }
    if (task.status === 'in-progress') {
      score += 12;
      reasons.push('Already in progress');
    }
    if (task.blockers.length > 0) {
      score -= 25;
      reasons.push(`Blocked by: ${task.blockers.join(', ')}`);
    }
    if (task.dependencies.length > 0) {
      reasons.push(`Depends on ${task.dependencies.length} other task(s)`);
    }
    if (reasons.length === 0) {
      reasons.push('Open task with no deadline recorded');
    }

    return { score, reasons };
  }

  /** The deterministic Today payload. Never requires the reasoning provider. */
  async today() {
    const day = this.now().toISOString().slice(0, 10);
    const horizon = new Date(this.now());
    horizon.setUTCDate(horizon.getUTCDate() + 7);
    const horizonDay = horizon.toISOString().slice(0, 10);

    const { tasks, files } = await this.taskRepository.list();
    const open = tasks.filter((task) => ['todo', 'in-progress', 'blocked'].includes(task.status));

    const overdue = sortTasks(open.filter((task) => task.dueDate && task.dueDate < day));
    const dueToday = sortTasks(open.filter((task) => task.dueDate === day));
    const upcoming = sortTasks(
      open.filter((task) => task.dueDate && task.dueDate > day && task.dueDate <= horizonDay)
    );
    const blocked = open.filter((task) => task.status === 'blocked' || task.blockers.length > 0);

    const sources = files.map((file) => ({
      path: file.path,
      sha: file.revision,
      title: 'Task records',
      reason: 'Deterministic task source'
    }));

    const recommendations = open
      .map((task) => {
        const { score, reasons } = this.#score(task, day);
        return {
          taskId: task.id,
          title: task.name,
          score,
          reasons,
          basis: 'deterministic',
          projectId: task.projectId,
          businessId: task.businessId,
          dueDate: task.dueDate,
          priority: task.priority,
          status: task.status,
          sources: [{ path: task.sourcePath, title: 'Task records', reason: 'Task record for this recommendation' }]
        };
      })
      .sort((a, b) => b.score - a.score || String(a.dueDate).localeCompare(String(b.dueDate)))
      .slice(0, 8);

    const [projects, businessList, dailyNotes] = await Promise.all([
      this.projectRepository.listDetailed().catch(() => ({ projects: [], sourcePath: null, revision: null })),
      this.businessRepository.list().catch(() => ({ businesses: [], sourcePath: null, revision: null })),
      this.dailyRepository.list(5).catch(() => [])
    ]);

    if (projects.sourcePath) {
      sources.push({
        path: projects.sourcePath,
        sha: projects.revision,
        title: 'Project registry',
        reason: 'Project context for the daily plan'
      });
    }

    // Open decisions and questions come from the project documents themselves.
    const unresolvedDecisions = [];
    for (const project of projects.projects.slice(0, 8)) {
      // eslint-disable-next-line no-await-in-loop
      const detail = await this.projectRepository.get(project.slug).catch(() => null);
      if (!detail) continue;
      for (const question of detail.openQuestions.slice(0, 3)) {
        unresolvedDecisions.push({ projectId: detail.id, projectName: detail.name, question, path: detail.path });
      }
    }

    const businessAlerts = businessList.businesses.map((business) => ({
      businessId: business.id,
      name: business.name,
      status: business.status || 'unknown',
      path: business.path
    }));

    return {
      date: day,
      recommendations,
      overdue,
      dueToday,
      upcoming,
      blocked,
      unresolvedDecisions,
      businessAlerts,
      recentActivity: this.auditService.list({ limit: 8 }),
      dailyNotes,
      counts: {
        open: open.length,
        overdue: overdue.length,
        dueToday: dueToday.length,
        upcoming: upcoming.length,
        blocked: blocked.length
      },
      sources,
      aiAvailable: this.provider.isConfigured()
    };
  }

  /**
   * Optional narrative plan. Deterministic facts are supplied to the provider
   * as authoritative context; a provider failure leaves the plan intact.
   */
  async proposePlan({ goal = 'Plan today' } = {}) {
    const plan = await this.today();

    if (!this.provider.isConfigured()) {
      return { plan, narrative: null, aiAvailable: false };
    }

    const context = await this.retrievalService.buildContext({
      scope: { type: 'vault', ids: [] },
      query: goal
    });

    const facts = {
      date: plan.date,
      counts: plan.counts,
      overdue: plan.overdue.slice(0, 10).map((task) => ({ id: task.id, name: task.name, dueDate: task.dueDate })),
      dueToday: plan.dueToday.slice(0, 10).map((task) => ({ id: task.id, name: task.name })),
      blocked: plan.blocked.slice(0, 10).map((task) => ({ id: task.id, name: task.name, blockers: task.blockers }))
    };

    const result = await this.provider.generatePlan(goal, context.sources, { facts });

    return {
      plan,
      narrative: {
        text: result.text,
        citations: result.citations,
        model: result.model,
        basis: 'ai-recommendation'
      },
      aiAvailable: true,
      contextManifest: context.sources.map(({ path, sha, title, reason }) => ({ path, sha, title, reason }))
    };
  }

  static get workspaceRulesPath() {
    return VAULT_PATHS.workspaceRules;
  }
}
