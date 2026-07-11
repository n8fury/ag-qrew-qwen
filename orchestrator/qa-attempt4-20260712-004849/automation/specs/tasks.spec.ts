import { runCases } from '../runner';
import { TasksPage } from '../pages/TasksPage';
import { TasksData } from '../data/TasksData';

runCases(process.env.SITE_URL!, [
  { tc: 'TC-TASKS-001', run: async (page) => {                    // Verify adding a new task succeeds
      const tasks = new TasksPage(page);
      await tasks.navigate();
      await tasks.fillTaskTitle(TasksData.validTitle);
      await tasks.clickAddTask();
      // No explicit verify method yet — stubbed for now
      // TODO: add verification of success toast or list update
  } },
  { tc: 'TC-TASKS-002', run: async (page) => {                    // Verify sign out returns to login page
      const tasks = new TasksPage(page);
      await tasks.navigate();
      await tasks.clickSignOut();
      await tasks.verifyOnLoginPage();
  } },
]);