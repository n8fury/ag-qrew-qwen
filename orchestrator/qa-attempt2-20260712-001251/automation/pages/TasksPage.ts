import { Page } from 'playwright';
import { TasksLocators } from '../locators/TasksLocators';

export class TasksPage {
  constructor(private page: Page) {}

  async navigate() {
    await this.page.goto(process.env.SITE_URL! + '/tasks');
  }

  async fillNewTaskTitle(title: string) {
    await TasksLocators.newTaskInput(this.page).fill(title);
  }

  async clickAddTask() {
    await TasksLocators.addTaskButton(this.page).click();
  }

  async clickSignOut() {
    await TasksLocators.signOutLink(this.page).click();
    await this.page.waitForURL('/', { timeout: 30000, waitUntil: 'commit' });
  }

  async verifyOnLoginPage() {
    if (!this.page.url().includes('/')) {
      throw new Error(`Expected URL to contain '/', got '${this.page.url()}'`);
    }
  }
}