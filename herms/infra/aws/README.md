# Manually managed AWS resources

HERMS does not create AWS resources from this repository. The production AWS
resources are created and configured manually in the AWS Management Console.
The API deployment workflow only updates the code of the existing Lambda
function.

## Existing resource contract

- Region: `ap-southeast-1`
- Lambda function: `herms-api`
- Runtime: Node.js 22.x
- Architecture: ARM64
- Handler: `lambda.handler`
- Memory: 512 MB
- Timeout: 20 seconds
- Execution role: `herms-lambda-execution-role`
- CloudWatch log group: `/aws/lambda/herms-api`
- Log retention: 14 days

The execution role needs only the AWS-managed
`AWSLambdaBasicExecutionRole` policy unless application code is changed to use
another AWS service.

## GitHub deployment contract

The `production-api` GitHub environment supplies:

- Variable: `AWS_REGION` (`ap-southeast-1`)
- Variable: `API_FUNCTION_NAME` (`herms-api`)
- Variable: `API_HEALTH_URL` (the full Function URL health endpoint)
- Secret: `AWS_DEPLOY_ROLE_ARN`

The OIDC deployment role should be limited to these actions on the
`herms-api` function:

- `lambda:GetFunction`
- `lambda:GetFunctionConfiguration`
- `lambda:UpdateFunctionCode`

Runtime secrets remain in the manually configured Lambda environment. They are
not copied into GitHub or committed to this repository.

## Important

Do not reintroduce a SAM or CloudFormation deployment without first importing
or deliberately replacing the manually managed resources. Creating another
function or log group with the same names will fail or create configuration
drift.
