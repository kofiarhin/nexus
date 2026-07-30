export function createProjectController({ projectService }) {
  return {
    async list(req, res, next) {
      try {
        const projects = await projectService.listProjects();
        return res.status(200).json({ success: true, data: { projects }, requestId: res.locals.requestId });
      } catch (error) {
        return next(error);
      }
    }
  };
}
