# AWS Setup Guide — Knowledge Base Project

Step-by-step setup in the correct order. Each section builds on the previous one.

---

## Step 1 — Create your AWS account

1. Go to https://aws.amazon.com and click **Create an AWS Account**
2. Enter your email, choose an account name (e.g. `itay-kb-prod`)
3. Add a credit card (required even for free tier)
4. Verify your phone number
5. Choose the **Basic (free) support plan** to start

**Immediately after signup — secure your root account:**
- Go to IAM → Security recommendations → Enable MFA on root account
- Use an authenticator app (Google Authenticator or Authy)
- After this, never use the root account again for daily work

---

## Step 2 — Create IAM users

You need two IAM users: one for yourself, one for GitLab CI.

### Your personal admin user
1. Go to **IAM → Users → Create user**
2. Name: `itay-admin`
3. Enable **AWS Management Console access**, set a password
4. Attach policy: `AdministratorAccess`
5. Enable MFA on this user too
6. Log out of root, log back in as `itay-admin` — use this from now on

### GitLab CI/CD user (limited permissions)
1. IAM → Users → Create user
2. Name: `gitlab-ci`
3. No console access (CLI only)
4. Attach these policies:
   - `AmazonEC2ContainerRegistryPowerUser` (push Docker images to ECR)
   - Create a custom inline policy for SSM deploy:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ssm:SendCommand", "ssm:GetCommandInvocation"],
      "Resource": "*"
    }
  ]
}
```
5. Go to the user → **Security credentials → Create access key** (CLI use case)
6. Copy the `Access Key ID` and `Secret Access Key` — save these for GitLab variables later

### EC2 IAM Role (so your server can access AWS services)
1. IAM → Roles → Create role
2. Trusted entity: **AWS service → EC2**
3. Attach these policies:
   - `AmazonS3FullAccess` (or scoped to your bucket)
   - `AmazonSSMManagedInstanceCore` (for SSM remote access)
   - `SecretsManagerReadWrite`
   - `AmazonEC2ContainerRegistryReadOnly` (to pull Docker images)
4. Name it: `ec2-kb-app-role`

---

## Step 3 — Set up your VPC and network

A VPC is your private network inside AWS. You need public subnets (for ALB, EC2) and private subnets (for RDS, Redis).

1. Go to **VPC → Create VPC**
   - Select **VPC and more** (creates everything at once)
   - Name: `kb-vpc`
   - IPv4 CIDR: `10.0.0.0/16`
   - Availability Zones: **2** (minimum for ALB)
   - Public subnets: **2**
   - Private subnets: **2**
   - NAT gateways: **1** (in 1 AZ — costs ~$30/mo but needed for private subnets)
   - Click Create

2. Note down the IDs of your **two public subnets** and **two private subnets** — you'll need them soon.

### Security Groups — create these now

**SG 1: ALB security group** (`sg-alb`)
- Inbound: port 80 (HTTP) from `0.0.0.0/0`, port 443 (HTTPS) from `0.0.0.0/0`
- Outbound: all traffic

**SG 2: EC2 security group** (`sg-ec2`)
- Inbound: port 8000 from `sg-alb` only (no direct internet access)
- Outbound: all traffic

**SG 3: RDS security group** (`sg-rds`)
- Inbound: port 5432 (PostgreSQL) from `sg-ec2` only
- Outbound: all traffic

**SG 4: Redis security group** (`sg-redis`)
- Inbound: port 6379 from `sg-ec2` only
- Outbound: all traffic

---

## Step 4 — Set up RDS (PostgreSQL)

1. Go to **RDS → Create database**
2. Engine: **PostgreSQL**, version 16.x
3. Template: **Free tier** (or Production if you want Multi-AZ)
4. DB instance identifier: `kb-postgres`
5. Master username: `kb_admin`
6. Master password: generate a strong one and **save it in a password manager**
7. Instance class: `db.t3.micro`
8. Storage: 20 GB, gp3, enable auto-scaling up to 100 GB
9. VPC: `kb-vpc`
10. Subnet group: Create new → select your **private subnets**
11. Public access: **No**
12. Security group: `sg-rds`
13. Initial database name: `knowledge_base`
14. Enable automated backups: 7 days retention
15. Click Create database (takes ~5 minutes)

Save the **endpoint URL** (something like `kb-postgres.xxxx.us-east-1.rds.amazonaws.com`) — you'll need this for your app config.

---

## Step 5 — Set up S3 (file storage)

1. Go to **S3 → Create bucket**
2. Bucket name: `kb-app-attachments-<your-account-id>` (must be globally unique)
3. Region: same as everything else (e.g. `us-east-1`)
4. Block all public access: **ON** (files are served via presigned URLs)
5. Versioning: enable (protects against accidental deletes)
6. Click Create bucket

---

## Step 6 — Set up ECR (Docker registry)

1. Go to **ECR → Create repository**
2. Visibility: **Private**
3. Repository name: `kb-app`
4. Image tag mutability: **Mutable** (allows overwriting the `latest` tag)
5. Enable scan on push (free basic scanning)
6. Click Create

Save the **repository URI** — it looks like:
`<account-id>.dkr.ecr.us-east-1.amazonaws.com/kb-app`

---

## Step 7 — Launch EC2

1. Go to **EC2 → Launch instance**
2. Name: `kb-app-server`
3. AMI: **Amazon Linux 2023** (or Ubuntu 22.04 LTS)
4. Instance type: `t3.small` (2 vCPU, 2 GB RAM)
5. Key pair: Create new → download the `.pem` file (keep it safe, you might not need it if using SSM)
6. Network settings:
   - VPC: `kb-vpc`
   - Subnet: one of your **public subnets**
   - Auto-assign public IP: **Enable**
   - Security group: `sg-ec2`
7. IAM instance profile: `ec2-kb-app-role`
8. Storage: 20 GB gp3
9. Launch instance

### After launch — install Docker on EC2

Connect via **EC2 Instance Connect** (browser-based) or SSM:
```bash
# For Amazon Linux 2023:
sudo yum update -y
sudo yum install -y docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker ec2-user

# Install AWS CLI (already present on AL2023, but verify)
aws --version

# Log into ECR (test that your IAM role works)
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com
```

Note down the **EC2 instance ID** (looks like `i-0abc123...`) — needed for GitLab CI.

---

## Step 8 — Set up ElastiCache Redis

1. Go to **ElastiCache → Create cluster**
2. Choose **Redis OSS**
3. Cluster mode: **Disabled** (simpler for small team)
4. Name: `kb-redis`
5. Node type: `cache.t3.micro`
6. Number of replicas: **0** (add 1 later if you need HA)
7. Subnet group: Create new → select your **private subnets**
8. Security group: `sg-redis`
9. Click Create

Save the **Primary endpoint** URL.

---

## Step 9 — Set up Secrets Manager

Store all sensitive values here — never in your code or `.env` files committed to git.

1. Go to **Secrets Manager → Store a new secret**
2. Type: **Other type of secret**
3. Add these key/value pairs:
   - `DB_HOST` → your RDS endpoint
   - `DB_NAME` → `knowledge_base`
   - `DB_USER` → `kb_admin`
   - `DB_PASSWORD` → your RDS password
   - `REDIS_URL` → your ElastiCache endpoint
   - `S3_BUCKET` → your bucket name
   - `ANTHROPIC_API_KEY` → get from https://console.anthropic.com
   - `JIRA_DOMAIN` → your Atlassian domain
   - `JIRA_EMAIL` → your email
   - `JIRA_API_TOKEN` → from https://id.atlassian.com/manage-profile/security/api-tokens
4. Secret name: `kb-app/prod`
5. Click Store

Your FastAPI app will load these at startup using `boto3`:
```python
import boto3, json

def get_secrets():
    client = boto3.client("secretsmanager", region_name="us-east-1")
    secret = client.get_secret_value(SecretId="kb-app/prod")
    return json.loads(secret["SecretString"])
```

---

## Step 10 — Set up ACM (SSL certificate)

Before creating the ALB or CloudFront, you need an SSL certificate.

1. Go to **Certificate Manager → Request a certificate**
2. Type: **Public certificate**
3. Domain name: `kb.yourdomain.com` (or `*.yourdomain.com` for wildcard)
4. Validation method: **DNS validation** (easier than email)
5. Click Request
6. On the next screen, click **Create records in Route 53** (if your domain is there) or manually add the CNAME record your DNS provider shows
7. Wait ~5 minutes for status to show **Issued**

---

## Step 11 — Set up ALB (load balancer)

1. Go to **EC2 → Load Balancers → Create load balancer**
2. Type: **Application Load Balancer**
3. Name: `kb-alb`
4. Scheme: **Internet-facing**
5. IP type: IPv4
6. Subnets: select both **public subnets**
7. Security group: `sg-alb`
8. Listeners: Add listener for **HTTPS (443)**, select your ACM certificate
9. Add a redirect rule: HTTP (80) → HTTPS (443)
10. Target group: Create new
    - Type: **Instances**
    - Name: `kb-ec2-targets`
    - Protocol: HTTP, port 8000
    - Health check path: `/api/health`
    - Register your EC2 instance
11. Click Create

Save the **ALB DNS name** (something like `kb-alb-xxxx.us-east-1.elb.amazonaws.com`).

---

## Step 12 — Set up CloudFront

1. Go to **CloudFront → Create distribution**
2. Origin domain: paste your **ALB DNS name**
3. Protocol: **HTTPS only**
4. Viewer protocol policy: **Redirect HTTP to HTTPS**
5. Allowed HTTP methods: **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE** (API needs all)
6. Cache policy: **CachingDisabled** for `/api/*` paths; **CachingOptimized** for static assets
7. Alternate domain names: add `kb.yourdomain.com`
8. Custom SSL certificate: select your ACM cert
9. Click Create distribution

**Add a cache behavior for the API** (so API calls aren't cached):
- Go to the distribution → Behaviors → Create behavior
- Path pattern: `/api/*`
- Cache policy: **CachingDisabled**
- Origin request policy: **AllViewer**

Note the **CloudFront domain name** (e.g. `dxxxx.cloudfront.net`).

---

## Step 13 — Set up Route 53 (DNS)

If your domain is already somewhere else (GoDaddy, Namecheap), either transfer it to Route 53 or just add a CNAME record there.

**Option A — domain managed in Route 53:**
1. Route 53 → Hosted zones → Create hosted zone
2. Domain name: `yourdomain.com`
3. Add an **A record** (alias): `kb.yourdomain.com` → CloudFront distribution
4. Update your domain registrar's nameservers to the 4 Route 53 nameservers

**Option B — domain managed elsewhere:**
1. Log into your registrar (GoDaddy, Namecheap, etc.)
2. Add a CNAME record: `kb` → `dxxxx.cloudfront.net`

---

## Step 14 — Set up Cognito (Google SSO)

1. Go to **Cognito → Create user pool**
2. Sign-in options: **Email**
3. Password policy: use the default (or set your own)
4. MFA: Optional (recommend enabling for your support team)
5. Email: Use **Cognito's built-in email** to start (or SES for production)
6. User pool name: `kb-users`
7. Hosted UI: **Enable**
8. Domain: choose a Cognito domain like `kb-auth.auth.us-east-1.amazoncognito.com`
9. App client:
   - App type: **Confidential client**
   - App client name: `kb-web-app`
   - Callback URL: `https://kb.yourdomain.com/auth/callback`
   - Sign-out URL: `https://kb.yourdomain.com/login`
10. Click Create

**Add Google as an identity provider:**
1. First, go to https://console.cloud.google.com → APIs & Services → Credentials → Create OAuth 2.0 Client ID
   - App type: Web application
   - Authorized redirect URI: `https://kb-auth.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
   - Copy the Client ID and Client Secret
2. Back in Cognito → User pool → Sign-in experience → Federated identity providers → Add Google
3. Paste the Google Client ID and Client Secret
4. Map attribute: Google `email` → Cognito `email`
5. Save

---

## Step 15 — First manual deploy (smoke test)

Before setting up GitLab CI, deploy once manually to verify everything connects.

On your local machine:
```bash
# 1. Build your Docker image
docker build -t kb-app .

# 2. Authenticate with ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com

# 3. Tag and push
docker tag kb-app:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/kb-app:latest
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/kb-app:latest
```

On the EC2 instance (via SSM or EC2 Instance Connect):
```bash
# Pull and run
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com

docker pull <account-id>.dkr.ecr.us-east-1.amazonaws.com/kb-app:latest

docker run -d \
  --name kb-app \
  --restart=always \
  -p 8000:8000 \
  -e AWS_REGION=us-east-1 \
  <account-id>.dkr.ecr.us-east-1.amazonaws.com/kb-app:latest
```

Check the ALB health check — in EC2 → Target Groups → your target group → Targets tab, the instance should show **healthy**.

Then visit `https://kb.yourdomain.com` — you should see your app.

---

## Step 16 — Set up GitLab CI/CD

1. In your GitLab repo → **Settings → CI/CD → Variables**, add:
   - `AWS_ACCESS_KEY_ID` → the `gitlab-ci` IAM user's key
   - `AWS_SECRET_ACCESS_KEY` → the `gitlab-ci` IAM user's secret
   - `AWS_REGION` → `us-east-1`
   - `ECR_REPO` → `<account-id>.dkr.ecr.us-east-1.amazonaws.com/kb-app`
   - `EC2_INSTANCE_ID` → your EC2 instance ID (e.g. `i-0abc123...`)

2. Add the `.gitlab-ci.yml` file from the architecture document to your repo root

3. Push to `main` — the pipeline should run automatically

---

## Summary Checklist

- [ ] AWS account created, root MFA enabled
- [ ] IAM users: `itay-admin`, `gitlab-ci`, EC2 role `ec2-kb-app-role`
- [ ] VPC with public + private subnets, security groups
- [ ] RDS PostgreSQL launched (private subnet)
- [ ] S3 bucket created
- [ ] ECR repository created
- [ ] EC2 launched with Docker installed and IAM role attached
- [ ] ElastiCache Redis launched (private subnet)
- [ ] Secrets Manager populated with all credentials
- [ ] ACM certificate issued for your domain
- [ ] ALB created pointing to EC2
- [ ] CloudFront distribution created pointing to ALB
- [ ] DNS configured (Route 53 or external)
- [ ] Cognito User Pool created with Google IdP
- [ ] First manual deploy succeeded (ALB shows instance healthy)
- [ ] GitLab CI variables set, pipeline runs on push to `main`
