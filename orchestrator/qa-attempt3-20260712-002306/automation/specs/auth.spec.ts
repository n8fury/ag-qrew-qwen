import { runCases } from '../runner';
import { AuthPage } from '../pages/AuthPage';
import { AuthData } from '../data/AuthData';

runCases(process.env.SITE_URL!, [
  { tc: 'TC-AUTH-001', run: async (page) => {                    // Verify admin login redirects to /tasks
      const auth = new AuthPage(page);
      await auth.navigate();
      await auth.fillEmail(AuthData.valid.adminEmail);
      await auth.fillPassword(AuthData.valid.adminPassword);
      await auth.clickSignIn();
      await auth.verifyOnTasksPage();
  } },
  { tc: 'TC-AUTH-002', run: async (page) => {                    // Verify standard user login redirects to /tasks
      const auth = new AuthPage(page);
      await auth.navigate();
      await auth.fillEmail(AuthData.valid.userEmail);
      await auth.fillPassword(AuthData.valid.userPassword);
      await auth.clickSignIn();
      await auth.verifyOnTasksPage();
  } },
]);