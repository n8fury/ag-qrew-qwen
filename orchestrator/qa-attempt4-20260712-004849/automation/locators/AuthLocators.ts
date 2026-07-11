/*
AuthLocators.ts — generated from probe of http://localhost:3000/
Elements observed:
- INPUT with label "admin@demo.test" (email field)
- INPUT with label "••••••••" (password field)
- BUTTON with name "Sign In"
- A with name "Go to tasks →" (post-login navigation)
*/

export class AuthLocators {
  static readonly emailInput = (page: any) => page.getByLabel('Email');
  static readonly passwordInput = (page: any) => page.getByLabel('Password');
  static readonly signInButton = (page: any) => page.getByRole('button', { name: 'Sign In' });
  static readonly goToTasksLink = (page: any) => page.getByRole('link', { name: 'Go to tasks →' });
}