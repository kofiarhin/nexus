import { describe, expect, it } from 'vitest';
import { parseTasks, serializeTask } from '../../server/repositories/taskRepository.js';
import { selectTasks, sortTasks } from '../../server/services/taskService.js';

const SOURCE = 'tasks/TASKS.md';
const NOW = new Date('2026-07-31T09:00:00.000Z');

describe('parseTasks', () => {
  it('reads every annotated field', () => {
    const [task] = parseTasks(
      '- [ ] Ship the release @id(tsk-1) @priority(critical) @due(2026-08-04) @project(nexus) '
      + '@business(acme) @owner(kofi) @recurrence(weekly) @depends(tsk-0,tsk-2) @blocked(waiting on review)',
      SOURCE
    );

    expect(task).toMatchObject({
      id: 'tsk-1',
      name: 'Ship the release',
      status: 'todo',
      priority: 'critical',
      dueDate: '2026-08-04',
      projectId: 'nexus',
      businessId: 'acme',
      owner: 'kofi',
      recurrence: 'weekly',
      dependencies: ['tsk-0', 'tsk-2'],
      blockers: ['waiting on review'],
      sourcePath: SOURCE
    });
  });

  it('supports a plain unannotated checklist item with a stable derived id', () => {
    const first = parseTasks('- [ ] Legacy task', SOURCE)[0];
    const second = parseTasks('- [ ] Legacy task', SOURCE)[0];

    expect(first.name).toBe('Legacy task');
    expect(first.status).toBe('todo');
    expect(first.priority).toBe('medium');
    expect(first.id).toBe(second.id);
    expect(first.hasExplicitId).toBe(false);
  });

  it('derives different ids for the same text in different documents', () => {
    expect(parseTasks('- [ ] Same', 'tasks/TASKS.md')[0].id)
      .not.toBe(parseTasks('- [ ] Same', 'projects/nexus/TASKS.md')[0].id);
  });

  it('treats the checkbox as authoritative for completion', () => {
    expect(parseTasks('- [x] Done @status(todo)', SOURCE)[0].status).toBe('done');
    expect(parseTasks('- [ ] Open @status(done)', SOURCE)[0].status).toBe('todo');
    expect(parseTasks('- [x] Archived @status(archived)', SOURCE)[0].status).toBe('archived');
  });

  it('falls back to defaults for unrecognised annotation values', () => {
    const [task] = parseTasks('- [ ] Task @priority(urgent) @recurrence(hourly) @due(soon)', SOURCE);
    expect(task.priority).toBe('medium');
    expect(task.recurrence).toBe('none');
    expect(task.dueDate).toBeNull();
  });

  it('records the source line so a task can be rewritten in place', () => {
    const tasks = parseTasks('# Tasks\n\n## Open\n\n- [ ] First\n- [ ] Second\n', SOURCE);
    expect(tasks.map((task) => task.sourceLine)).toEqual([4, 5]);
  });
});

describe('serializeTask', () => {
  it('round-trips a fully populated task', () => {
    const original = parseTasks(
      '- [ ] Ship it @id(tsk-1) @priority(high) @due(2026-08-04) @project(nexus) @depends(tsk-0)',
      SOURCE
    )[0];

    const reparsed = parseTasks(serializeTask(original), SOURCE)[0];
    expect(reparsed).toMatchObject({
      id: original.id,
      name: original.name,
      priority: original.priority,
      dueDate: original.dueDate,
      projectId: original.projectId,
      dependencies: original.dependencies
    });
  });

  it('checks the box for a completed task', () => {
    expect(serializeTask({ id: 'a', name: 'Done', status: 'done', priority: 'low' })).toContain('- [x] Done');
  });

  it('omits empty annotations', () => {
    const line = serializeTask({ id: 'a', name: 'Simple', status: 'todo', priority: 'medium' });
    expect(line).not.toContain('@due(');
    expect(line).not.toContain('@project(');
  });

  it('preserves indentation and list marker', () => {
    expect(serializeTask({ id: 'a', name: 'Nested', status: 'todo', priority: 'low', indent: '  ', marker: '*' }))
      .toBe('  * [ ] Nested @id(a) @status(todo) @priority(low)');
  });
});

describe('selectTasks', () => {
  const tasks = parseTasks(
    [
      '- [ ] Overdue @id(a) @due(2026-07-01) @priority(high)',
      '- [ ] Due today @id(b) @due(2026-07-31)',
      '- [ ] Next week @id(c) @due(2026-08-03)',
      '- [ ] Far future @id(d) @due(2026-12-01)',
      '- [ ] No deadline @id(e) @project(nexus)',
      '- [ ] Blocked @id(f) @blocked(waiting)',
      '- [ ] Recurring @id(g) @recurrence(weekly)',
      '- [x] Completed @id(h)'
    ].join('\n'),
    SOURCE
  );

  const ids = (view, filters = {}) => selectTasks(tasks, { view, ...filters }, NOW).map((task) => task.id);

  it('selects overdue and due-today work for the today view', () => {
    expect(ids('today').sort()).toEqual(['a', 'b']);
  });

  it('selects only past-due work for the overdue view', () => {
    expect(ids('overdue')).toEqual(['a']);
  });

  it('limits upcoming to the next seven days', () => {
    expect(ids('upcoming')).toEqual(['c']);
  });

  it('selects completed, recurring, and blocked views', () => {
    expect(ids('completed')).toEqual(['h']);
    expect(ids('recurring')).toEqual(['g']);
    expect(ids('blocked')).toEqual(['f']);
  });

  it('excludes completed work from deadline views', () => {
    expect(ids('today')).not.toContain('h');
  });

  it('applies project, priority, and text filters', () => {
    expect(ids('all', { projectId: 'nexus' })).toEqual(['e']);
    expect(ids('all', { priority: 'high' })).toEqual(['a']);
    expect(ids('all', { search: 'recurring' })).toEqual(['g']);
  });
});

describe('sortTasks', () => {
  it('orders by due date, then priority, then name', () => {
    const tasks = parseTasks(
      [
        '- [ ] Zebra @id(z) @due(2026-08-01) @priority(low)',
        '- [ ] Alpha @id(a) @due(2026-08-01) @priority(low)',
        '- [ ] Critical @id(c) @due(2026-08-01) @priority(critical)',
        '- [ ] Undated @id(u)'
      ].join('\n'),
      SOURCE
    );

    expect(sortTasks(tasks).map((task) => task.id)).toEqual(['c', 'a', 'z', 'u']);
  });
});
