module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Type must be one of the following
    'type-enum': [
      2,
      'always',
      [
        'feat', // New feature
        'fix', // Bug fix
        'docs', // Documentation only
        'style', // Code style (formatting, semicolons, etc.)
        'refactor', // Code refactoring
        'perf', // Performance improvement
        'test', // Adding or updating tests
        'build', // Build system or external dependencies
        'ci', // CI/CD configuration
        'chore', // Maintenance tasks
        'revert', // Revert a previous commit
      ],
    ],
    // Subject should not be empty
    'subject-empty': [2, 'never'],
    // Subject should not end with a period
    'subject-full-stop': [2, 'never', '.'],
    // Subject should be in lowercase
    'subject-case': [2, 'always', 'lower-case'],
    // Type should not be empty
    'type-empty': [2, 'never'],
    // Type should be in lowercase
    'type-case': [2, 'always', 'lower-case'],
    // Header max length
    'header-max-length': [2, 'always', 100],
  },
};
