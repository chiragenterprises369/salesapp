import { z } from 'zod';
import { TaskPrioritySchema, TaskStatusSchema, TaskTypeSchema } from '../enums.js';
import { CursorPaginationQuerySchema, IdSchema, IsoDateTimeSchema, queryArray } from './common.js';
import { UserSummarySchema } from './workspace.js';

export const TaskSchema = z.object({
  id: IdSchema,
  type: TaskTypeSchema,
  title: z.string(),
  notes: z.string().nullable(),
  status: TaskStatusSchema,
  priority: TaskPrioritySchema,
  leadId: IdSchema.nullable(),
  leadName: z.string().nullable(),
  assignee: UserSummarySchema.nullable(),
  dueAt: IsoDateTimeSchema.nullable(),
  remindAt: IsoDateTimeSchema.nullable(),
  snoozedUntil: IsoDateTimeSchema.nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
  source: z.enum(['manual', 'workflow', 'system']),
  workflowRunId: IdSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type Task = z.infer<typeof TaskSchema>;

const TaskInputFields = z.object({
  type: TaskTypeSchema,
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(5000).optional(),
  priority: TaskPrioritySchema,
  leadId: IdSchema.optional(),
  assigneeId: IdSchema.optional().describe('Defaults to the current user'),
  dueAt: IsoDateTimeSchema.optional(),
  remindAt: IsoDateTimeSchema.optional(),
});

export const TaskCreateSchema = TaskInputFields.extend({
  type: TaskTypeSchema.default('todo'),
  priority: TaskPrioritySchema.default('normal'),
});
export type TaskCreate = z.infer<typeof TaskCreateSchema>;

/** Built from the default-free base (Zod 4 `.partial()` keeps defaults). */
export const TaskUpdateSchema = TaskInputFields.partial().extend({
  status: TaskStatusSchema.optional(),
});
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;

export const TaskSnoozeSchema = z.object({ until: IsoDateTimeSchema });

export const TaskListQuerySchema = CursorPaginationQuerySchema.extend({
  scope: z.enum(['mine', 'team']).default('mine'),
  status: queryArray(TaskStatusSchema),
  type: queryArray(TaskTypeSchema),
  due: z.enum(['overdue', 'today', 'upcoming', 'none']).optional(),
  leadId: IdSchema.optional(),
  assigneeId: IdSchema.optional(),
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
});
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;
