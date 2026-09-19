export class ProjectService {
  constructor(projectRepository) {
    this.projectRepository = projectRepository;
  }

  async listProjects() {
    return this.projectRepository.list();
  }

  async getProject(projectId) {
    return this.projectRepository.get(projectId);
  }
}

export class BusinessService {
  constructor(businessRepository) {
    this.businessRepository = businessRepository;
  }

  async listBusinesses() {
    return this.businessRepository.list();
  }

  async getBusiness(businessId) {
    return this.businessRepository.get(businessId);
  }
}
