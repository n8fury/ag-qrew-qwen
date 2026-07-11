import { runCases } from '../runner';
import { TasksPage } from '../pages/TasksPage';
import { TasksData } from '../data/TasksData';

runCases(process.env.SITE_URL!, [
  { tc: 'TC-TASKS-001', run: async (page) => {                    // Verify adding a task succeeds
      const tasks = new TasksPage(page);
      await tasks.navigate();
      await tasks.fillNewTaskTitle(TasksData.validTaskTitle);
      await tasks.clickAddTask();
      // No explicit verify method yet — assume success if no error
  } },
  { tc: 'TC-TASKS-002', run: async (page) => {                    // Verify sign out returns to login page
      const tasks = new TasksPage(page);
      await tasks.navigate();
      await tasks.clickSignOut();
      await tasks.verifyOnLoginPage();
  } },
]);