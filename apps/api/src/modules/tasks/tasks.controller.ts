import { Body, Controller, Param, Query } from '@nestjs/common';
import {
  API_ROUTES,
  IdParamSchema,
  TaskCreateSchema,
  TaskListQuerySchema,
  TaskSnoozeSchema,
  TaskUpdateSchema,
  type TaskCreate,
  type TaskListQuery,
  type TaskUpdate,
} from '@vistar/shared';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { TasksService } from './tasks.service.js';

type IdParam = { id: string };

@Controller()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @ApiRoute(API_ROUTES.taskList)
  list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(TaskListQuerySchema)) query: TaskListQuery) {
    return this.tasks.list(auth, query);
  }

  @ApiRoute(API_ROUTES.taskCreate)
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(TaskCreateSchema)) body: TaskCreate) {
    return this.tasks.create(auth, body);
  }

  @ApiRoute(API_ROUTES.taskUpdate)
  update(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(TaskUpdateSchema)) body: TaskUpdate) {
    return this.tasks.update(auth, id, body);
  }

  @ApiRoute(API_ROUTES.taskSnooze)
  snooze(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(TaskSnoozeSchema)) body: { until: string }) {
    return this.tasks.snooze(auth, id, body.until);
  }

  @ApiRoute(API_ROUTES.taskDelete)
  remove(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.tasks.remove(auth, id);
  }
}
