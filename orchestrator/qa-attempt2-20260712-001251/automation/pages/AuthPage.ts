import { Page } from 'playwright';
import { AuthLocators } from '../locators/AuthLocators';

export class AuthPage {
  constructor(private page: Page) {}

  async navigate() {
    await this.page.goto(process.env.SITE_URL! + '/');
  }

  async fillEmail(email: string) {
    await AuthLocators.emailInput(this.page).fill(email);
  }

  async fillPassword(password: string) {
    await AuthLocators.passwordInput(this.page).fill(password);
  }

  async clickSignIn() {
    await AuthLocators.signInButton(this.page).click();
    await this.page.waitForURL('/tasks', { timeout: 30000, waitUntil: 'commit' });
  }

  async clickGoToTasks() {
    await AuthLocators.goToTasksLink(this.page).click();
    await this.page.waitForURL('/tasks', { timeout: 30000, waitUntil: 'commit' });
  }

  async verifyOnTasksPage() {
    if (!this.page.url().includes('/tasks')) {
      throw new Error(`Expected URL to contain '/tasks', got '${this.page.url()}'`);
    }
  }
}