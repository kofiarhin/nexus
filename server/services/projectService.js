export class ProjectService {
  constructor(projectRepository) {
    this.projectRepository = projectRepository;
  }

  async listProjects() {
    return this.projectRepository.list();
  }
}
