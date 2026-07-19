pipeline {
    agent any

    environment {
        APP_NAME = 'airhire'
        DOCKERFILE = 'Dockerfile.genz'
        IMAGE_TAG = "${BUILD_NUMBER}"
        DOCKER_HOST='tcp://elated_robinson:2375'
        DOCKER_TLS_VERIFY=''
        DOCKER_CERT_PATH= ''
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
                    docker info
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
                echo 'No automated test configured yet'
            }
        }

        stage('Build Docker Image') {
            steps {
                sh '''
                    docker build \
                        -f "${DOCKERFILE}" \
                        -t "${APP_NAME}:${IMAGE_TAG}" \
                        -t "${APP_NAME}:${GIT_COMMIT}" \
                        .
                '''
            }
        }    
stage('Push to ECR') {
    steps {
        withCredentials([[
            $class: 'AmazonWebServicesCredentialsBinding',
            credentialsId: 'aws-ecr-credentials'
        ]]) {
            sh '''
                echo "=== Sanity check: CLI version ==="
                docker run --rm amazon/aws-cli --version 2>&1
                echo "exit code: $?"

                echo "=== Checking credentials ==="
                docker run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY amazon/aws-cli sts get-caller-identity 2>&1
                echo "exit code: $?"

                echo "=== Fetching ECR login password ==="
                docker run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY amazon/aws-cli ecr get-login-password --region ap-south-1 2>&1
                echo "exit code: $?"
            '''
        }
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