// DevsLoop Vault API — Jenkins CI/CD pipeline (NestJS 11 + Prisma 6 + pnpm).
//
// This pipeline is designed to run on Jenkins with a stock agent (no AnsiColor
// plugin required). Flow:
//   checkout -> pnpm install -> materialize .env -> prisma generate
//   -> lint:check -> typecheck -> unit tests -> nest build
//   -> archive dist/ -> (optional) docker build + push on deploy branches.
//
// Branch strategy (edit DEPLOY_BRANCHES in the environment block):
//   - `jenkins-deployment` — use while wiring the pipeline (build + deploy).
//   - `main` — production (add when ready).
//   - any other branch — build + quality gates only, no image push.
//
// Required Jenkins configuration:
//   - Node.js tool named "node-20" (Manage Jenkins -> Tools). Node 20+ ships
//     with Corepack; the pipeline enables pnpm 10 to match package.json.
//
//   - ONE credential (kind: Secret file) with ID: `devsloop-vault-api-env`.
//     The file is a standard dotenv (KEY=value per line) with the variables
//     your runtime and future jobs need (see `.env.jenkins.example` in the repo).
//     CI stages here do not boot the Nest app, but the file is materialized so
//     Prisma tooling, future e2e jobs, or ad-hoc steps see the same env as prod.
//
//   - For Docker deploy branches only — username/password credential with ID:
//     `devsloop-vault-api-registry` (e.g. GitHub username + PAT with `write:packages`
//     for GHCR). The pipeline runs `docker login` + `docker build` + `docker push`.
//     The agent must have the Docker CLI available.
//
//   - Set DOCKER_IMAGE in the Jenkins job environment (or override below) to the
//     full image reference, e.g. ghcr.io/<org>/devsloop-vault-api-service:latest
//     Set DOCKER_REGISTRY to the login host (ghcr.io, docker.io, etc.).
//
//   - GitHub webhook -> https://<jenkins>/github-webhook/ (push event), or poll SCM.

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20', daysToKeepStr: '30'))
    timeout(time: 30, unit: 'MINUTES')
  }

  tools {
    nodejs 'node-20'
  }

  environment {
    CI = 'true'
    HUSKY = '0'
    // Comma-separated branches allowed to build and push the Docker image.
    DEPLOY_BRANCHES = 'jenkins-deployment'
    // Override per Jenkins job to your registry path.
    DOCKER_IMAGE = 'ghcr.io/devsloop/devsloop-vault-api-service:latest'
    // Host passed to `docker login` (must match the registry in DOCKER_IMAGE).
    DOCKER_REGISTRY = 'ghcr.io'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        sh '''
          set -eu
          node --version
          corepack enable
          corepack prepare pnpm@10.0.0 --activate
          pnpm --version
        '''
      }
    }

    stage('Install') {
      steps {
        sh 'pnpm install --frozen-lockfile'
      }
    }

    stage('Prepare env') {
      steps {
        withCredentials([file(credentialsId: 'devsloop-vault-api-env', variable: 'ENV_FILE')]) {
          sh '''
            set -eu
            cp "$ENV_FILE" .env
            chmod 600 .env
            echo "[.env] $(grep -c '^[A-Za-z_][A-Za-z0-9_]*=' .env || true) variables loaded."
          '''
        }
      }
    }

    stage('Prisma generate') {
      steps {
        sh 'pnpm prisma generate'
      }
    }

    stage('Lint') {
      steps {
        sh 'pnpm lint:check'
      }
    }

    stage('Typecheck') {
      steps {
        sh 'pnpm typecheck'
      }
    }

    stage('Test') {
      steps {
        sh 'pnpm test'
      }
    }

    stage('Build') {
      steps {
        sh 'pnpm build'
      }
    }

    stage('Archive build') {
      steps {
        archiveArtifacts artifacts: 'dist/**', allowEmptyArchive: false, onlyIfSuccessful: true
      }
    }

    stage('Deploy (Docker)') {
      when {
        expression {
          def current = env.BRANCH_NAME ?: (env.GIT_BRANCH ?: '').replaceFirst(/^origin\//, '')
          def allowed = (env.DEPLOY_BRANCHES ?: '').split(',').collect { it.trim() }.findAll { it }
          echo "Current branch: '${current}'. Allowed deploy branches: ${allowed}."
          return allowed.contains(current)
        }
      }
      steps {
        withCredentials([
          usernamePassword(
            credentialsId: 'devsloop-vault-api-registry',
            usernameVariable: 'REG_USER',
            passwordVariable: 'REG_PASS',
          ),
        ]) {
          sh '''
            set -eu
            test -n "${DOCKER_IMAGE:-}"
            echo "$REG_PASS" | docker login "$DOCKER_REGISTRY" -u "$REG_USER" --password-stdin
            docker build -t "$DOCKER_IMAGE" .
            docker push "$DOCKER_IMAGE"
            echo "[deploy] Pushed $DOCKER_IMAGE"
          '''
        }
      }
    }
  }

  post {
    success {
      echo "Build #${env.BUILD_NUMBER} OK on ${env.BRANCH_NAME ?: env.GIT_BRANCH}"
    }
    failure {
      echo "Build #${env.BUILD_NUMBER} FAILED — check stage logs."
    }
    always {
      sh '''
        rm -f .env || true
        rm -rf node_modules || true
        rm -rf dist || true
      '''
    }
  }
}
