import { runCases } from '../runner';

runCases(process.env.SITE_URL!, [
  { tc: 'TC-001', run: async (page) => { // Verify that entering valid credentials and clicking Sign In redirects to the dashboard and displays the Welcome message
      await page.goto(process.env.SITE_URL! + '/');
      await page.getByPlaceholder('Email').fill('admin@demo.test');
      await page.getByPlaceholder('Password').fill('admin123');
      await page.getByRole('button', { name: 'Sign In' }).click();
      await page.waitForURL('/tasks');
      await page.getByText('Welcome, admin@demo.test').waitFor();
  } },
  { tc: 'TC-002', run: async (page) => { // Verify that entering invalid credentials shows an error message
      await page.goto(process.env.SITE_URL! + '/');
      await page.getByPlaceholder('Email').fill('invalid@example.com');
      await page.getByPlaceholder('Password').fill('wrong');
      await page.getByRole('button', { name: 'Sign In' }).click();
      await page.getByText('Invalid email or password').waitFor();
  } },
  { tc: 'TC-003', run: async (page) => { // Verify that clicking "Go to tasks →" without logging in redirects to login
      await page.goto(process.env.SITE_URL! + '/');
      await page.getByRole('link', { name: 'Go to tasks →' }).click();
      await page.waitForURL('/');
      await page.getByPlaceholder('Email').waitFor();
  } },
]);
