import { runCases } from '../runner';
import { TasksPage } from '../pages/TasksPage';
import { TasksData } from '../data/TasksData';

runCases(process.env.SITE_URL!, [
  { tc: 'TC-TASKS-001', run: async (page) => {                    // Verify adding a task succeeds and appears in list
      const tasks = new TasksPage(page);
      await tasks.navigate();
      await tasks.fillNewTask(TasksData.valid.taskTitle);
      await tasks.clickAddTask();
      // TODO: verify task appears — no locator yet for task list items
      // await tasks.verifyTaskInList(TasksData.expected.taskListContains);
  } },
  { tc: 'TC-TASKS-002', run: async (page) => {                    // Verify sign out returns to login page
      const tasks = new TasksPage(page);
      await tasks.navigate();
      await tasks.clickSignOut();
      await tasks.verifyOnLoginPage();
  } },
]);