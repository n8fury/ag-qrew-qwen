import { runCases } from '../runner';
import { AuthPage } from '../pages/AuthPage';
import { AuthData } from '../data/AuthData';

runCases(process.env.SITE_URL!, [
  { tc: 'TC-AUTH-001', run: async (page) => {                    // Verify admin login succeeds and redirects to /tasks
      const auth = new AuthPage(page);
      await auth.navigate();
      await auth.fillEmail(AuthData.admin.email);
      await auth.fillPassword(AuthData.admin.password);
      await auth.clickSignIn();
      await auth.verifyOnTasksPage();
  } },
  { tc: 'TC-AUTH-002', run: async (page) => {                    // Verify standard user login succeeds and redirects to /tasks
      const auth = new AuthPage(page);
      await auth.navigate();
      await auth.fillEmail(AuthData.user.email);
      await auth.fillPassword(AuthData.user.password);
      await auth.clickSignIn();
      await auth.verifyOnTasksPage();
  } },
]);