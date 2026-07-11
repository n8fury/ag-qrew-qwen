import { Page } from 'playwright';
import { AuthLocators } from '../locators/AuthLocators';

export class AuthPage {
  constructor(private page: Page) {}

  async navigate(): Promise<void> {
    await this.page.goto(process.env.SITE_URL! + '/');
  }

  async fillEmail(email: string): Promise<void> {
    await AuthLocators.emailInput(this.page).fill(email);
  }

  async fillPassword(password: string): Promise<void> {
    await AuthLocators.passwordInput(this.page).fill(password);
  }

  async clickSignIn(): Promise<void> {
    await Promise.all([
      this.page.waitForURL('/tasks', { timeout: 5000 }),
      AuthLocators.signInButton(this.page).click()
    ]);
  }

  async clickGoToTasks(): Promise<void> {
    await Promise.all([
      this.page.waitForURL('/tasks', { timeout: 5000 }),
      AuthLocators.goToTasksLink(this.page).click()
    ]);
  }

  async verifyOnTasksPage(): Promise<void> {
    if (!this.page.url().includes('/tasks')) {
      throw new Error(`Expected URL to contain '/tasks', got '${this.page.url()}'`);
    }
  }
}