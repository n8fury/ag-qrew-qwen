import { Page } from 'playwright';
import { TasksLocators } from '../locators/TasksLocators';

export class TasksPage {
  constructor(private page: Page) {}

  async navigate(): Promise<void> {
    await this.page.goto(process.env.SITE_URL! + '/tasks');
  }

  async fillNewTask(title: string): Promise<void> {
    await TasksLocators.newTaskInput(this.page).fill(title);
  }

  async clickAddTask(): Promise<void> {
    await TasksLocators.addTaskButton(this.page).click();
  }

  async clickSignOut(): Promise<void> {
    await Promise.all([
      this.page.waitForURL('/', { timeout: 5000 }),
      TasksLocators.signOutLink(this.page).click()
    ]);
  }

  async verifyOnLoginPage(): Promise<void> {
    if (!this.page.url().includes('/')) {
      throw new Error(`Expected URL to contain '/', got '${this.page.url()}'`);
    }
  }
}