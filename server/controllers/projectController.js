import { appError } from '../utils/errors.js';
import { ok } from '../utils/respond.js';
import { asyncHandler } from './helpers.js';

export function createProjectController({ projectService }) {
  return {
    list: asyncHandler(async (req, res) => {
      const projects = await projectService.listProjects();
      return ok(res, { projects });
    }),

    get: asyncHandler(async (req, res) => {
      const project = await projectService.getProject(req.params.projectId);
      if (!project) throw appError('NOT_FOUND', 'Project not found');
      return ok(res, { project });
    })
  };
}

export function createBusinessController({ businessService }) {
  return {
    list: asyncHandler(async (req, res) => {
      const { businesses, registered, sourcePath } = await businessService.listBusinesses();
      return ok(res, { businesses, registered, sourcePath });
    }),

    get: asyncHandler(async (req, res) => {
      const business = await businessService.getBusiness(req.params.businessId);
      if (!business) throw appError('NOT_FOUND', 'Business not found');
      return ok(res, { business });
    })
  };
}
