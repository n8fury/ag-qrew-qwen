import { runCases } from '../runner';
import { AuthPage } from '../pages/AuthPage';
import { AuthData } from '../data/AuthData';

runCases(process.env.SITE_URL!, [
  { tc: 'TC-AUTH-001', run: async (page) => {                    // Verify admin login redirects to /tasks
      const auth = new AuthPage(page);
      await auth.navigate();
      await auth.fillEmail(AuthData.valid.email);
      await auth.fillPassword(AuthData.valid.password);
      await auth.clickSignIn();
      await auth.verifyOnTasksPage();
  } },
  { tc: 'TC-AUTH-002', run: async (page) => {                    // Verify standard user login redirects to /tasks
      const auth = new AuthPage(page);
      await auth.navigate();
      await auth.fillEmail('user@demo.test');
      await auth.fillPassword('user123');
      await auth.clickSignIn();
      await auth.verifyOnTasksPage();
  } },
]);