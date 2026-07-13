import { runCases } from '../runner';

runCases(process.env.SITE_URL!, [
  { tc: 'TC-001', run: async (page) => { // Verify that entering a new task title and clicking Add creates the task and displays it in the task list
      await page.goto(process.env.SITE_URL! + '/tasks');
      await page.getByPlaceholder('New task title').fill('Test Task 1');
      await page.getByRole('button', { name: 'Add' }).click();
      await page.getByText('Test Task 1').waitFor();
  } },
  { tc: 'TC-002', run: async (page) => { // Verify that clicking "← Sign out" logs the user out and redirects to login
      await page.goto(process.env.SITE_URL! + '/tasks');
      await page.getByRole('link', { name: '← Sign out' }).click();
      await page.waitForURL('/');
      await page.getByPlaceholder('Email').waitFor();
  } },
]);
