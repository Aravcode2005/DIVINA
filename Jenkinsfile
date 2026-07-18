pipeline {
    agent any

    environment {
        APP_NAME = 'airhire'
        DOCKERFILE = 'Dockerfile.genz'
        IMAGE_TAG = "${BUILD_NUMBER}"
    }

    stages {
        stage('Checkout') {
            steps {
                echo 'Checking out source code...'
                checkout scm
            }
        }

        stage('Verify Environment') {
            steps {
                sh '''
                    node --version
                    npm --version
                    docker --version
                '''
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Run Tests') {
            steps {
                sh 'npm test'
            }
        }

        stage('Build Docker Image') {
            steps {
                sh '''
                    docker build \
                        -f "${DOCKERFILE}" \
                        -t "${APP_NAME}:${IMAGE_TAG}" \
                        -t "${APP_NAME}:latest" \
                        .
                '''
            }
        }

        stage('Inspect Image') {
            steps {
                sh 'docker image inspect "${APP_NAME}:${IMAGE_TAG}"'
            }
        }
    }

    post {
        success {
            echo "Pipeline succeeded. Built ${APP_NAME}:${IMAGE_TAG}"
        }

        failure {
            echo 'Pipeline failed. Check the failed stage logs.'
        }

        always {
            echo "Build ${BUILD_NUMBER} has completed."
        }
    }
}