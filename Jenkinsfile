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
                aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin 209197638193.dkr.ecr.ap-south-1.amazonaws.com

                docker tag "${APP_NAME}:${IMAGE_TAG}" 209197638193.dkr.ecr.ap-south-1.amazonaws.com/airehirex:${IMAGE_TAG}

                docker push 209197638193.dkr.ecr.ap-south-1.amazonaws.com/airehirex:${IMAGE_TAG}
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