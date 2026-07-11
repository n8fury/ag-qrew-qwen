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
    await AuthLocators.signInButton(this.page).click();
    await this.page.waitForURL('/tasks', { timeout: 10000 });
  }

  async clickGoToTasks(): Promise<void> {
    await AuthLocators.goToTasksLink(this.page).click();
    await this.page.waitForURL('/tasks', { timeout: 10000 });
  }

  async verifyOnTasksPage(): Promise<void> {
    if (!this.page.url().includes('/tasks')) {
      throw new Error(`Expected URL to contain '/tasks', got '${this.page.url()}'`);
    }
  }
}