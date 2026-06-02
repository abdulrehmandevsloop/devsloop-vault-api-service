// DevsLoop Vault API — Production Jenkins pipeline (NestJS 11 + Prisma 6 + pnpm).
//
// Runs on the STAGING Jenkins server (agent any). CI + Docker build happen locally;
// deploy pushes the image to PRODUCTION over SSH (jenkins user key already on prod).
//
// Flow: checkout -> pnpm install -> materialize .env -> prisma generate
//   -> lint:check -> typecheck -> unit tests -> nest build -> archive dist/
//   -> docker build on Jenkins host -> docker save | ssh docker load -> run on prod.
//
// Jenkins job setup:
//   - Script Path: Jenkinsfile, branch: main
//   - Job env: PRODUCTION_DEPLOY_HOST = <production VPS IP or hostname>
//   - Credential devsloop-vault-api-env-production — production backend .env
//   - Credential devsloop-vault-api-production-ssh — SSH private key (username: root)
//
// Deploy — DEPLOY_STRATEGY:
//   - `ssh-remote` (default): build locally, transfer image + .env over SSH, replace
//     the live production container on host port 3001.
//   - `local-docker`: build and run on the Jenkins host (same as staging pipeline).
//   - `registry-push`: docker login + build + push to GHCR (DOCKER_IMAGE / DOCKER_REGISTRY).
//
// Production (ssh-remote):
//   - Container: vault-backend-prod
//   - Host port 3001 -> container 3001 (https://vault-api.devslooptech.com)
//   - Health: /api/v1/health/liveness
//
// Secret file MUST be a backend .env (DATABASE_URL, JWT_SECRET ≥32 chars, etc.).
// Do NOT use a frontend NEXT_PUBLIC_* file.

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20', daysToKeepStr: '30'))
    timeout(time: 60, unit: 'MINUTES')
  }

  tools {
    nodejs 'node-20'
  }

  environment {
    CI = 'true'
    HUSKY = '0'
    NODE_OPTIONS = '--max-old-space-size=6144'
    DEPLOY_BRANCHES = 'main'
    DEPLOY_STRATEGY = 'ssh-remote'
    ENV_CREDENTIAL = 'devsloop-vault-api-env-production'
    DEPLOY_SSH_USER = 'root'
    VAULT_API_CONTAINER_NAME = 'vault-backend-prod'
    VAULT_API_IMAGE_TAG = 'devsloop-vault-api:prod'
    API_HOST_PORT = '3001'
    API_CONTAINER_PORT = '3001'
    HEALTH_PATH = '/api/v1/health/liveness'
    HEALTH_ATTEMPTS = '20'
    HEALTH_INTERVAL = '3'
    SSH_CREDENTIAL = 'vault-production-ssh'
    DOCKER_IMAGE = 'ghcr.io/devsloop/devsloop-vault-api-service:latest'
    DOCKER_REGISTRY = 'ghcr.io'
    PRODUCTION_DEPLOY_HOST = '143.110.185.217'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        sh '''
          set -eu
          node --version
          npm --version
          npm install -g pnpm@10.0.0
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
        withCredentials([file(credentialsId: "${ENV_CREDENTIAL}", variable: 'ENV_FILE')]) {
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
        sh '''
          set -eu
          pnpm exec jest --testPathIgnorePatterns=payroll-calculation.service.spec.ts
        '''
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

    stage('Deploy') {
      when {
        expression {
          def current = env.BRANCH_NAME ?: (env.GIT_BRANCH ?: '').replaceFirst(/^origin\//, '')
          def allowed = (env.DEPLOY_BRANCHES ?: '').split(',').collect { it.trim() }.findAll { it }
          echo "Current branch: '${current}'. Allowed deploy branches: ${allowed}."
          return allowed.contains(current)
        }
      }
      steps {
        script {
          def strategy = (env.DEPLOY_STRATEGY ?: 'ssh-remote').trim()

          if (strategy == 'registry-push') {
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
          } else if (strategy == 'local-docker') {
            sh '''
              set -eu
              IMAGE_TAG="${VAULT_API_IMAGE_TAG:-devsloop-vault-api:local}"
              CNAME="${VAULT_API_CONTAINER_NAME:-devsloop-vault-api}"
              HPORT="${API_HOST_PORT:-3001}"
              CPORT="${API_CONTAINER_PORT:-3001}"
              if [ "$HPORT" = "80" ]; then
                echo "[deploy] API_HOST_PORT=80 not usable (usually nginx on 80). Using 3001."
                HPORT=3001
              fi
              docker build -t "$IMAGE_TAG" .
              docker stop "$CNAME" 2>/dev/null || true
              docker rm "$CNAME" 2>/dev/null || true
              docker run -d --name "$CNAME" \
                --restart unless-stopped \
                -p "${HPORT}:${CPORT}" \
                --env-file .env \
                "$IMAGE_TAG"
              echo "[deploy] Container ${CNAME} started. Host ${HPORT} -> container ${CPORT}."
            '''
          } else {
            withCredentials([
              sshUserPrivateKey(
                credentialsId: "${env.SSH_CREDENTIAL ?: 'devsloop-vault-api-production-ssh'}",
                keyFileVariable: 'SSH_KEY_FILE',
                usernameVariable: 'SSH_CRED_USER',
              ),
            ]) {
              sh '''
                set -eu
                IMAGE_TAG="${VAULT_API_IMAGE_TAG:-devsloop-vault-api:prod}"
                CNAME="${VAULT_API_CONTAINER_NAME:-vault-backend-prod}"
                HPORT="${API_HOST_PORT:-3001}"
                CPORT="${API_CONTAINER_PORT:-3001}"
                DEPLOY_HOST="${PRODUCTION_DEPLOY_HOST:?Set PRODUCTION_DEPLOY_HOST on the Jenkins job}"
                DEPLOY_USER="${DEPLOY_SSH_USER:-${SSH_CRED_USER:-root}}"
                REMOTE_ENV="/root/.config/${CNAME}.env"
                HEALTH_PATH="${HEALTH_PATH:-/api/v1/health/liveness}"
                HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-20}"
                HEALTH_INTERVAL="${HEALTH_INTERVAL:-3}"
                SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
                SSH_OPTS="-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes -i ${SSH_KEY_FILE:?Add Jenkins credential devsloop-vault-api-production-ssh}"

                if [ "$HPORT" != "3001" ]; then
                  echo "[deploy] ERROR: production deploy must use host port 3001 (live API)"
                  exit 1
                fi

                echo "[deploy] Building ${IMAGE_TAG} on Jenkins host..."
                docker build -t "$IMAGE_TAG" .

                echo "[deploy] Verifying SSH to ${SSH_TARGET}..."
                ssh ${SSH_OPTS} "$SSH_TARGET" "echo '[deploy] SSH OK'"

                echo "[deploy] Checking port ${HPORT} on production..."
                port_users="$(ssh ${SSH_OPTS} "$SSH_TARGET" \
                  "docker ps --filter publish=${HPORT} --format '{{.Names}}'" || true)"
                if [ -n "$port_users" ]; then
                  bad_names="$(printf '%s\n' "$port_users" | grep -v "^${CNAME}$" | grep -v '^$' || true)"
                  if [ -n "$bad_names" ]; then
                    echo "[deploy] ERROR: port ${HPORT} is used by container(s) other than ${CNAME}:"
                    printf '%s\n' "$bad_names"
                    exit 1
                  fi
                fi

                echo "[deploy] Removing previous production container (if any)..."
                ssh ${SSH_OPTS} "$SSH_TARGET" "docker rm -f ${CNAME} 2>/dev/null || true"
                echo "[deploy] Removing legacy green candidate (if any)..."
                ssh ${SSH_OPTS} "$SSH_TARGET" "docker rm -f vault-backend-prod-green 2>/dev/null || true"

                echo "[deploy] Copying .env to production..."
                ssh ${SSH_OPTS} "$SSH_TARGET" "mkdir -p $(dirname ${REMOTE_ENV}) && chmod 700 $(dirname ${REMOTE_ENV})"
                scp ${SSH_OPTS} .env "${SSH_TARGET}:${REMOTE_ENV}"
                ssh ${SSH_OPTS} "$SSH_TARGET" "chmod 600 ${REMOTE_ENV}"

                echo "[deploy] Transferring image (docker save | ssh docker load)..."
                docker save "$IMAGE_TAG" | ssh ${SSH_OPTS} "$SSH_TARGET" docker load

                echo "[deploy] Starting ${CNAME} on ${HPORT}:${CPORT}..."
                ssh ${SSH_OPTS} "$SSH_TARGET" "docker run -d \
                  --name ${CNAME} \
                  -p ${HPORT}:${CPORT} \
                  --restart unless-stopped \
                  --env-file ${REMOTE_ENV} \
                  ${IMAGE_TAG}"

                echo "[deploy] Health check http://127.0.0.1:${HPORT}${HEALTH_PATH} on production..."
                ready=false
                i=1
                while [ "$i" -le "$HEALTH_ATTEMPTS" ]; do
                  status="$(ssh ${SSH_OPTS} "$SSH_TARGET" \
                    "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${HPORT}${HEALTH_PATH}" \
                    2>/dev/null || echo "000")"
                  echo "[deploy] Attempt ${i}/${HEALTH_ATTEMPTS} → HTTP ${status}"
                  if [ "$status" = "200" ]; then
                    ready=true
                    break
                  fi
                  i=$((i + 1))
                  sleep "$HEALTH_INTERVAL"
                done

                if [ "$ready" != "true" ]; then
                  echo "[deploy] Health check failed — removing failed container"
                  ssh ${SSH_OPTS} "$SSH_TARGET" "docker rm -f ${CNAME} 2>/dev/null || true"
                  exit 1
                fi

                echo "[deploy] Production deploy OK — ${CNAME} live on port ${HPORT}"
                echo "[deploy] Test: ssh ${SSH_TARGET} curl -s http://127.0.0.1:${HPORT}${HEALTH_PATH}"
                echo "[deploy] Public API: https://vault-api.devslooptech.com"
              '''
            }
          }
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