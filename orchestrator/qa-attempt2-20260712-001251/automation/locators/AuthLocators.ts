/*
AuthLocators.ts
- Observed URL: http://localhost:3000/
- Auth required: none (public login page)
- Elements observed (probe): email input (label="admin@demo.test"), password input (label="••••••••"), Sign In button (name="Sign In"), Go to tasks link (name="Go to tasks →")
*/
export const AuthLocators = {
  emailInput: (page: import('playwright').Page) => page.getByRole('textbox', { name: 'Email' }),
  passwordInput: (page: import('playwright').Page) => page.getByRole('textbox', { name: 'Password' }),
  signInButton: (page: import('playwright').Page) => page.getByRole('button', { name: 'Sign In' }),
  goToTasksLink: (page: import('playwright').Page) => page.getByText('Go to tasks →'),
};