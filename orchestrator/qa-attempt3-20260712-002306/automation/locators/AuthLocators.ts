// AuthLocators.ts — built from probe of http://localhost:3000/ (unauthenticated)
// Elements observed: email input (placeholder "admin@demo.test"), password input (placeholder "••••••••"), Sign In button, Go to tasks link

export const AuthLocators = {
  emailInput: (page) => page.getByPlaceholder("admin@demo.test"),
  passwordInput: (page) => page.getByPlaceholder("••••••••"),
  signInButton: (page) => page.getByRole("button", { name: "Sign In" }),
  goToTasksLink: (page) => page.getByText("Go to tasks →")
};