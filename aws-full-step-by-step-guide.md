# Full AWS Setup Guide — Knowledge Base Project
### Every click, every command, every field

---

## Before You Start — What You'll Need

- A **credit card** (required by AWS even for free-tier resources)
- A **domain name** you own (e.g. `yourdomain.com`) — you'll point it at the app
- Your **GitLab repo** for the knowledge base project already created
- About **2–3 hours** to complete everything in one sitting (or spread across sessions)
- A **password manager** open and ready — you'll generate several credentials

> **Tip:** Do these steps in order. Each one builds on the previous. Don't skip ahead.

---

## Step 1 — Create Your AWS Account

1. Open your browser and go to **https://aws.amazon.com**
2. Click the orange **"Create an AWS Account"** button (top right)
3. On the sign-up page:
   - **Email address:** enter your email
   - **AWS account name:** type something like `itay-kb-prod` (this is just a label)
   - Click **Verify email address**
4. AWS sends you a 6-digit verification code — check your inbox and enter it
5. Create a **root password** — make it strong (16+ characters), save it in your password manager
6. On the "Contact Information" page:
   - Account type: **Personal** (or Business if this is company infrastructure)
   - Fill in your name, phone, address
7. On the "Billing Information" page — enter your credit card. You won't be charged if you stay within free tier limits, and our setup costs roughly $70/month total
8. On the "Identity verification" page — enter your phone number and verify via SMS or call
9. Choose the **Basic support plan** (free) — click **Complete sign up**
10. Click **Go to the AWS Management Console**
11. Sign in with your email and the root password you just created

You are now in the AWS Console. The URL looks like `https://console.aws.amazon.com`.

> **Region:** In the top-right corner of the console, you'll see a region name (e.g. "N. Virginia"). Before doing anything else, click it and select **US East (N. Virginia) — us-east-1**. Do all your work in this region.

---

## Step 2 — Secure the Root Account with MFA

The root account has unlimited power. If someone gets into it, they can delete everything and rack up a huge bill. MFA (two-factor authentication) stops that.

1. In the AWS Console top-right corner, click your account name → **Security credentials**
2. Scroll down to **"Multi-factor authentication (MFA)"** → click **Assign MFA device**
3. MFA device name: type `root-mfa`
4. Choose **Authenticator app** → click Next
5. Open **Google Authenticator** or **Authy** on your phone
6. Tap the **+** button → **Scan a QR code**
7. Scan the QR code shown on the AWS screen
8. Enter the first 6-digit code from the app, wait for it to rotate, enter the second 6-digit code
9. Click **Add MFA**

You'll see a green "MFA assigned successfully" confirmation.

> **From now on, never use the root account for daily work.** You'll create a personal admin user in the next step and use that instead.

---

## Step 3 — Create IAM Users and Roles

IAM (Identity and Access Management) controls who can do what in AWS. You need three things: a personal admin user for yourself, a restricted user for GitLab CI, and a role for your EC2 server.

### 3a — Create your personal admin user

1. In the AWS Console, search for **IAM** in the top search bar and click it
2. In the left menu, click **Users** → click **Create user** (top right)
3. **User name:** `itay-admin`
4. Check **"Provide user access to the AWS Management Console"**
5. Select **"I want to create an IAM user"**
6. **Console password:** Choose "Custom password" and enter a strong password — save it
7. Uncheck "Users must create a new password at next sign-in"
8. Click **Next**
9. On "Set permissions": choose **"Attach policies directly"**
10. Search for `AdministratorAccess` and check the checkbox next to it
11. Click **Next** → **Create user**
12. **Important:** On the success page, note the **Console sign-in URL** shown — it looks like `https://123456789.signin.aws.amazon.com/console`

Now sign out from the root account and sign back in as `itay-admin` using that URL. Add MFA to `itay-admin` as well (same steps as above — go to IAM → Users → `itay-admin` → Security credentials → Assign MFA device).

---

### 3b — Create the GitLab CI/CD user

This user has just enough permissions to push Docker images and trigger deploys — nothing else.

1. IAM → Users → **Create user**
2. **User name:** `gitlab-ci`
3. Do **not** check the console access box (this user only needs CLI access)
4. Click **Next**
5. Choose **"Attach policies directly"**
6. Search for `AmazonEC2ContainerRegistryPowerUser` → check it
7. Click **Next** → **Create user**

Now give this user a custom policy for SSM deploys:
1. Click into the `gitlab-ci` user you just created
2. Click the **"Add permissions"** dropdown → **"Create inline policy"**
3. Click **JSON** tab and paste this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:SendCommand",
        "ssm:GetCommandInvocation",
        "ssm:ListCommandInvocations"
      ],
      "Resource": "*"
    }
  ]
}
```

4. Click **Next** → Policy name: `GitLabDeploySSM` → **Create policy**

Now generate an access key for GitLab:
1. While still on the `gitlab-ci` user page, click **"Security credentials"** tab
2. Scroll to "Access keys" → click **"Create access key"**
3. Use case: **"Command Line Interface (CLI)"** → check the confirmation box → Next
4. Description: `GitLab CI pipeline` → click **Create access key**
5. **Copy both the Access Key ID and the Secret Access Key right now** — the secret is only shown once. Paste them into your password manager.

---

### 3c — Create the EC2 IAM role

Your EC2 server needs permission to pull Docker images from ECR, read secrets from Secrets Manager, and accept SSM connections — without hardcoding any credentials on the server.

1. IAM → left menu → **Roles** → **Create role**
2. Trusted entity type: **"AWS service"**
3. Use case: **EC2** → click it → click **Next**
4. Search and check these policies one by one:
   - `AmazonSSMManagedInstanceCore` (enables SSM shell access)
   - `AmazonEC2ContainerRegistryReadOnly` (lets EC2 pull Docker images from ECR)
   - `SecretsManagerReadWrite` (lets the app read credentials)
   - `AmazonS3FullAccess` (lets the app read/write to your S3 bucket)
5. Click **Next**
6. **Role name:** `ec2-kb-app-role`
7. Click **Create role**

---

## Step 4 — Set Up Your VPC (Virtual Private Network)

A VPC is your private network inside AWS. You'll put public-facing things (EC2, ALB) in public subnets, and databases in private subnets where the internet can't reach them directly.

1. Search for **VPC** in the console → click it
2. Click **"Create VPC"** (orange button)
3. Select **"VPC and more"** at the top (this creates everything at once)
4. Fill in the settings:
   - **Name tag auto-generation:** `kb-vpc` (it will create `kb-vpc-vpc`, `kb-vpc-subnet-public1`, etc.)
   - **IPv4 CIDR block:** `10.0.0.0/16`
   - **IPv6 CIDR block:** No IPv6 CIDR block
   - **Tenancy:** Default
   - **Number of Availability Zones:** `2`
   - **Number of public subnets:** `2`
   - **Number of private subnets:** `2`
   - **NAT gateways:** `In 1 AZ` (this costs ~$32/month but is required so your private subnets can reach the internet for updates and API calls)
   - **VPC endpoints:** None
5. Click **Create VPC**

Wait about 2 minutes for everything to be created. When done, click **View VPC**.

**Write down these IDs** — you'll need them throughout the rest of this guide:
- Your **VPC ID** (looks like `vpc-0abc123...`)
- The two **public subnet IDs** (in different availability zones, e.g. `us-east-1a` and `us-east-1b`)
- The two **private subnet IDs** (also in both AZs)

To find them: in the left menu go to **Subnets** and filter by your VPC.

---

## Step 5 — Create Security Groups

Security groups are virtual firewalls. Each one controls what traffic can flow in and out of a specific resource. You'll create four.

Go to **VPC → Security groups** in the left menu.

---

### SG 1 — ALB security group (public internet → load balancer)

1. Click **Create security group**
2. **Name:** `sg-alb`
3. **Description:** `Allow public HTTP and HTTPS to the load balancer`
4. **VPC:** select `kb-vpc`
5. Under **Inbound rules**, click **Add rule** twice:
   - Rule 1: Type = `HTTP`, Port = `80`, Source = `0.0.0.0/0`
   - Rule 2: Type = `HTTPS`, Port = `443`, Source = `0.0.0.0/0`
6. Outbound rules: leave the default (All traffic, `0.0.0.0/0`)
7. Click **Create security group**
8. **Copy the Security Group ID** (looks like `sg-0abc123...`)

---

### SG 2 — EC2 security group (load balancer → app server)

1. Click **Create security group**
2. **Name:** `sg-ec2`
3. **Description:** `Allow traffic from ALB to EC2 only`
4. **VPC:** `kb-vpc`
5. Under **Inbound rules**, click **Add rule**:
   - Type = `Custom TCP`, Port range = `8000`, Source = choose **"Custom"** and paste the `sg-alb` security group ID you copied above
6. Outbound: leave default
7. Click **Create security group**
8. Copy this Security Group ID too

---

### SG 3 — RDS security group (app server → database)

1. Click **Create security group**
2. **Name:** `sg-rds`
3. **Description:** `Allow PostgreSQL from EC2 only`
4. **VPC:** `kb-vpc`
5. Inbound rule:
   - Type = `PostgreSQL`, Port = `5432`, Source = Custom → paste the `sg-ec2` ID
6. Click **Create security group**

---

### SG 4 — Redis security group (app server → cache)

1. Click **Create security group**
2. **Name:** `sg-redis`
3. **Description:** `Allow Redis from EC2 only`
4. **VPC:** `kb-vpc`
5. Inbound rule:
   - Type = `Custom TCP`, Port = `6379`, Source = Custom → paste the `sg-ec2` ID
6. Click **Create security group**

---

## Step 6 — Launch RDS PostgreSQL (Your Database)

1. Search for **RDS** in the console → click it
2. Click **"Create database"**
3. **Database creation method:** Standard create
4. **Engine type:** PostgreSQL
5. **Engine version:** PostgreSQL 16.x (pick the latest 16.x shown)
6. **Templates:** Free tier (this selects `db.t3.micro` automatically — fine for your team size)
7. Under **Settings:**
   - **DB instance identifier:** `kb-postgres`
   - **Master username:** `kb_admin`
   - **Credentials management:** Self managed
   - **Master password:** generate a strong password (e.g. 32 random characters) — **save this in your password manager right now**
   - **Confirm password:** re-enter it
8. **Instance configuration:** `db.t3.micro` (already selected if you chose Free tier)
9. **Storage:**
   - Storage type: `gp3`
   - Allocated storage: `20` GB
   - Enable storage autoscaling: checked, max `100` GB
10. **Connectivity:**
    - **Compute resource:** Don't connect to an EC2 compute resource (you'll do this manually)
    - **Network type:** IPv4
    - **VPC:** `kb-vpc`
    - **DB subnet group:** Click "Create new DB subnet group" — this will appear automatically. It uses your private subnets.
    - **Public access:** **No** (very important — database must not be on the internet)
    - **VPC security group:** Click "Choose existing" → remove the default → add `sg-rds`
    - **Availability Zone:** No preference
11. **Database authentication:** Password authentication
12. **Additional configuration:**
    - **Initial database name:** `knowledge_base`
    - **Enable automated backups:** checked
    - **Backup retention period:** `7` days
    - Uncheck "Enable Enhanced Monitoring" (saves cost)
    - Uncheck "Enable auto minor version upgrade" (you'll upgrade intentionally)
13. Click **"Create database"**

This takes 5–10 minutes. While it's creating, move on to the next step.

When it's done: click on `kb-postgres` → copy the **Endpoint** (looks like `kb-postgres.xxxx.us-east-1.rds.amazonaws.com`) and the **Port** (`5432`). Save these.

---

## Step 7 — Create S3 Bucket (File Storage)

1. Search for **S3** → click it
2. Click **"Create bucket"**
3. **Bucket name:** `kb-app-files-YOUR-ACCOUNT-ID` — replace YOUR-ACCOUNT-ID with your 12-digit AWS account number (visible in the top-right corner of the console). S3 bucket names must be globally unique.
4. **AWS Region:** `US East (N. Virginia) us-east-1`
5. **Object Ownership:** ACLs disabled (recommended)
6. **Block Public Access settings:** leave all 4 checkboxes checked (block everything — files are served via presigned URLs, not direct public access)
7. **Versioning:** Enable — this protects against accidental deletion
8. **Default encryption:** Server-side encryption with Amazon S3 managed keys (SSE-S3) — leave default
9. Click **"Create bucket"**

Note the bucket name — you'll add it to Secrets Manager later.

---

## Step 8 — Create ECR Repository (Docker Image Registry)

1. Search for **ECR** (Elastic Container Registry) → click it
2. Click **"Create repository"**
3. **Visibility settings:** Private
4. **Repository name:** `kb-app`
5. **Tag mutability:** Mutable (allows overwriting the `latest` tag during deploys)
6. **Scan on push:** Enabled (free basic vulnerability scanning)
7. **Encryption configuration:** AES-256 (default)
8. Click **"Create repository"**

On the next page, you'll see your repository. Click on `kb-app` to open it and copy the **URI** — it looks like:
`123456789.dkr.ecr.us-east-1.amazonaws.com/kb-app`

**Save this URI** — you'll use it in many places.

---

## Step 9 — Launch Your EC2 Instance

1. Search for **EC2** → click it
2. Click **"Launch instance"** (orange button)
3. **Name:** `kb-app-server`
4. **Application and OS Images:**
   - Click "Amazon Linux" — select **Amazon Linux 2023 AMI** (the one that says "Free tier eligible")
5. **Instance type:** `t3.small` (2 vCPU, 2 GB RAM — click "Compare instance types" if you don't see it, search for `t3.small`)
6. **Key pair:** Click **"Create new key pair"**
   - Key pair name: `kb-app-key`
   - Key pair type: RSA
   - Private key file format: `.pem`
   - Click **"Create key pair"** — the `.pem` file downloads automatically
   - **Move this file to `~/.ssh/` on your computer and run `chmod 400 ~/.ssh/kb-app-key.pem`**
7. **Network settings** — click **"Edit"** to expand:
   - **VPC:** `kb-vpc`
   - **Subnet:** choose one of your **public** subnets (e.g. `kb-vpc-subnet-public1-us-east-1a`)
   - **Auto-assign public IP:** Enable
   - **Firewall (security groups):** Select existing → choose `sg-ec2`
8. **Storage:** 20 GiB, gp3 — leave default
9. **Advanced details** — expand this section:
   - **IAM instance profile:** select `ec2-kb-app-role`
   - Scroll to the bottom — leave everything else default
10. Click **"Launch instance"**

Wait about 1 minute for the instance to start. Click on the instance ID, then click "Connect" to verify you can connect.

**Copy and save the Instance ID** (looks like `i-0abc123def456789`) — you'll need it for GitLab CI.

---

## Step 10 — Install Docker on EC2

Connect to your instance:

**Option A — Browser-based (easiest):**
1. In EC2, click your instance → click **"Connect"** button
2. Make sure "EC2 Instance Connect" tab is selected → click **"Connect"**
3. A browser terminal opens

**Option B — From your terminal:**
```bash
ssh -i ~/.ssh/kb-app-key.pem ec2-user@YOUR-EC2-PUBLIC-IP
```
(Find the public IP in the EC2 instance details page)

Once connected, run these commands one at a time:

```bash
# Update the system
sudo yum update -y

# Install Docker
sudo yum install -y docker

# Start Docker and enable it to start on reboot
sudo systemctl start docker
sudo systemctl enable docker

# Add ec2-user to the docker group so you don't need sudo
sudo usermod -aG docker ec2-user

# Apply the group change (or log out and back in)
newgrp docker

# Verify Docker is working
docker --version
# Should print something like: Docker version 25.x.x
```

Now test that your EC2 role can talk to ECR:
```bash
# Replace ACCOUNT-ID and REGION with your values
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  YOUR-ACCOUNT-ID.dkr.ecr.us-east-1.amazonaws.com
```

You should see: `Login Succeeded`

If it says "Unable to locate credentials", your IAM role isn't attached — go back to EC2, select the instance, Actions → Security → Modify IAM role → select `ec2-kb-app-role`.

---

## Step 11 — Set Up ElastiCache Redis

1. Search for **ElastiCache** → click it
2. In the left menu click **"Redis caches"** → click **"Create Redis cache"**
3. **Deployment option:** Design your own cache
4. **Creation method:** Cluster cache
5. **Cluster mode:** Disabled
6. **Name:** `kb-redis`
7. **Location:** AWS Cloud
8. **Cluster info:**
   - Engine version: leave default (latest 7.x)
   - Port: `6379`
   - Parameter group: default
   - Node type: **`cache.t3.micro`** (click "Change node type" and search for it)
   - Number of replicas: `0`
9. **Subnet group:**
   - Click **"Create new subnet group"**
   - Name: `kb-redis-subnet-group`
   - Description: `Redis subnets for KB app`
   - VPC: `kb-vpc`
   - Subnets: select both **private** subnets
   - Click **Create**
10. **Security:**
    - Security groups: click X to remove the default → click the field and select `sg-redis`
11. **Encryption:**
    - Encryption at rest: enabled
    - Encryption in transit: enabled
12. Click **"Create"**

Takes 5–10 minutes. When done, click into `kb-redis` and copy the **Primary endpoint** (looks like `kb-redis.xxxxx.ng.0001.use1.cache.amazonaws.com:6379`). Save this.

---

## Step 12 — Set Up Secrets Manager

You'll store every credential here so your app never needs hardcoded passwords or API keys.

1. Search for **Secrets Manager** → click it
2. Click **"Store a new secret"**
3. **Secret type:** Other type of secret
4. **Key/value pairs** — click "Add row" for each one and fill in:

| Key | Value |
|-----|-------|
| `DB_HOST` | your RDS endpoint (from Step 6) |
| `DB_PORT` | `5432` |
| `DB_NAME` | `knowledge_base` |
| `DB_USER` | `kb_admin` |
| `DB_PASSWORD` | your RDS master password |
| `REDIS_URL` | `redis://your-elasticache-endpoint:6379` |
| `S3_BUCKET` | your S3 bucket name from Step 7 |
| `AWS_REGION` | `us-east-1` |
| `ANTHROPIC_API_KEY` | get from https://console.anthropic.com → API Keys → Create Key |
| `JIRA_DOMAIN` | your Atlassian subdomain (e.g. `mycompany` from `mycompany.atlassian.net`) |
| `JIRA_EMAIL` | your Atlassian account email |
| `JIRA_API_TOKEN` | get from https://id.atlassian.com/manage-profile/security/api-tokens → Create API token |

5. **Encryption key:** leave default (aws/secretsmanager)
6. Click **Next**
7. **Secret name:** `kb-app/prod`
8. **Description:** `Production credentials for the Knowledge Base app`
9. Click **Next** → **Next** → **Store**

You can add more keys later (Salesforce credentials, etc.) by clicking the secret and hitting "Edit".

---

## Step 13 — Request an SSL Certificate (ACM)

You need HTTPS for your app. AWS Certificate Manager gives you a free certificate.

1. Search for **Certificate Manager** → click it
2. **Important:** Make sure you're in **us-east-1** region (check top-right corner)
3. Click **"Request a certificate"**
4. Certificate type: **Public certificate** → Next
5. **Fully qualified domain name:** type `kb.yourdomain.com` (replace with your actual domain and subdomain)
6. Click **"Add another name to this certificate"** → type `yourdomain.com` (add the root domain too, for future flexibility)
7. **Validation method:** DNS validation (recommended)
8. **Key algorithm:** RSA 2048
9. Click **Request**

On the next screen you'll see your certificate with status **"Pending validation"**. You need to prove you own the domain:

**If your domain is in Route 53:**
- Click the certificate → scroll to "Domains" section → click **"Create records in Route 53"** → click **Create records**
- Wait 5 minutes — status changes to **Issued**

**If your domain is elsewhere (GoDaddy, Namecheap, etc.):**
- In the certificate details, you'll see a **CNAME name** and **CNAME value** for each domain
- Log into your domain registrar's DNS settings
- Create a CNAME record: Name = the CNAME name shown (just the part before your domain), Value = the CNAME value shown
- Wait 5–30 minutes for DNS propagation — status changes to **Issued**

Don't continue to Step 14 until you see **Issued** status. Copy the **Certificate ARN** (shown at the top of the certificate details) — you'll need it for the ALB.

---

## Step 14 — Create the Application Load Balancer (ALB)

The ALB sits between CloudFront and your EC2 instance. It handles HTTPS, health checks, and routing.

**First, create a Target Group (the EC2 instances the ALB sends traffic to):**

1. EC2 → left menu → **Target Groups** → **Create target group**
2. **Target type:** Instances
3. **Target group name:** `kb-ec2-targets`
4. **Protocol:** HTTP, **Port:** `8000`
5. **VPC:** `kb-vpc`
6. **Protocol version:** HTTP1
7. **Health checks:**
   - Health check protocol: HTTP
   - Health check path: `/api/health` (you'll add this endpoint to your FastAPI app — see note below)
   - Healthy threshold: `2`
   - Unhealthy threshold: `3`
   - Timeout: `5` seconds
   - Interval: `30` seconds
8. Click **Next**
9. Under "Register targets": check the box next to your `kb-app-server` EC2 instance
10. Click **"Include as pending below"** → click **"Create target group"**

> **Note:** Add a health check endpoint to your FastAPI app:
> ```python
> @app.get("/api/health")
> def health():
>     return {"status": "ok"}
> ```

**Now create the ALB:**

1. EC2 → left menu → **Load Balancers** → **Create load balancer**
2. Choose **Application Load Balancer** → click Create
3. **Load balancer name:** `kb-alb`
4. **Scheme:** Internet-facing
5. **IP address type:** IPv4
6. **Network mapping:**
   - VPC: `kb-vpc`
   - Mappings: check both Availability Zones → for each one, select the **public** subnet
7. **Security groups:** click the X to remove the default → add `sg-alb`
8. **Listeners and routing:**
   - Listener 1: Protocol `HTTP`, Port `80` — Action: **Redirect to HTTPS** → Port `443`, Status code `301`
   - Click **"Add listener"**
   - Listener 2: Protocol `HTTPS`, Port `443` — Action: **Forward to** → select `kb-ec2-targets`
   - For the HTTPS listener, under **"Secure listener settings":** select your ACM certificate from the dropdown
9. Click **Create load balancer**

Wait ~1 minute. When done, click on `kb-alb` and copy the **DNS name** (looks like `kb-alb-123456789.us-east-1.elb.amazonaws.com`). Save this.

---

## Step 15 — Set Up CloudFront (CDN + Security Layer)

CloudFront caches your static React files globally and puts a WAF layer in front of your app.

1. Search for **CloudFront** → click it
2. Click **"Create a CloudFront distribution"**
3. **Origin:**
   - **Origin domain:** Click the field and **do not** select from the dropdown — instead, manually type (or paste) your ALB DNS name: `kb-alb-123456789.us-east-1.elb.amazonaws.com`
   - **Protocol:** HTTPS only
   - **HTTPS port:** 443
   - **Minimum origin SSL protocol:** TLSv1.2
   - **Origin name:** leave as auto-filled
4. **Default cache behavior:**
   - **Compress objects automatically:** Yes
   - **Viewer protocol policy:** Redirect HTTP to HTTPS
   - **Allowed HTTP methods:** GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE
   - **Cache key and origin requests:** Cache policy and origin request policy
     - Cache policy: **CachingDisabled** (start here — you can tune caching per path later)
     - Origin request policy: **AllViewer**
5. **Web Application Firewall (WAF):** Click **"Enable security protections"** — this adds basic DDoS and bot protection for free via the managed rules
6. **Settings:**
   - **Alternate domain name (CNAME):** click **"Add item"** → type `kb.yourdomain.com`
   - **Custom SSL certificate:** select your ACM certificate from the dropdown
   - **Default root object:** `index.html`
7. Click **"Create distribution"**

**Add a separate cache behavior for the API** (so API responses are never cached):
1. Click on your new distribution → click the **"Behaviors"** tab → **"Create behavior"**
2. **Path pattern:** `/api/*`
3. **Origin:** your ALB origin
4. **Compress:** No
5. **Viewer protocol policy:** HTTPS only
6. **Allowed HTTP methods:** GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE
7. **Cache policy:** **CachingDisabled**
8. **Origin request policy:** **AllViewer**
9. Click **Save changes**

The distribution takes 5–15 minutes to deploy globally. Copy your **Distribution domain name** (looks like `dxxxx.cloudfront.net`).

---

## Step 16 — Configure DNS

You need to point `kb.yourdomain.com` at CloudFront.

### Option A — Your domain is managed in Route 53

1. Search for **Route 53** → click it
2. Left menu → **Hosted zones** → click on your domain (if you don't have one, click "Create hosted zone", enter your domain, click Create)
3. Click **"Create record"**
4. **Record name:** `kb` (this creates `kb.yourdomain.com`)
5. **Record type:** A
6. Toggle **"Alias"** to ON
7. **Route traffic to:** Alias to CloudFront distribution
8. **Choose distribution:** select your CloudFront distribution from the dropdown
9. Click **Create records**

DNS propagates in a few minutes.

### Option B — Your domain is at another registrar (GoDaddy, Namecheap, etc.)

1. Log into your domain registrar's control panel
2. Find the DNS settings for your domain
3. Add a **CNAME** record:
   - **Name/Host:** `kb`
   - **Value/Points to:** your CloudFront domain name (`dxxxx.cloudfront.net`)
   - **TTL:** 300 (5 minutes)
4. Save

DNS can take 5 minutes to 48 hours to propagate depending on your registrar. You can check propagation at https://dnschecker.org — type `kb.yourdomain.com` and look for the CloudFront domain.

---

## Step 17 — Set Up Google SSO with AWS Cognito

This is a two-part step: first set up a Google OAuth app, then configure Cognito.

### Part A — Create a Google OAuth App

1. Go to **https://console.cloud.google.com**
2. At the top, click the project dropdown → **"New Project"**
   - Project name: `KB App Auth`
   - Click **Create**
3. Make sure your new project is selected in the dropdown
4. In the left menu, go to **APIs & Services → OAuth consent screen**
5. **User type:** External → click **Create**
6. Fill in:
   - **App name:** `Knowledge Base`
   - **User support email:** your email
   - **Developer contact information:** your email
7. Click **Save and Continue** through the Scopes page (no changes needed)
8. On "Test users": add your own email → click **Save and Continue** → **Back to Dashboard**
9. Now go to **APIs & Services → Credentials** → click **"+ Create Credentials"** → **OAuth client ID**
10. **Application type:** Web application
11. **Name:** `KB Cognito`
12. Under **Authorized redirect URIs** → click **"+ Add URI"** — leave this blank for now (you'll come back to fill it in after creating Cognito)
13. Click **Create**
14. A popup shows your **Client ID** and **Client secret** — copy both into your password manager

### Part B — Create AWS Cognito User Pool

1. Search for **Cognito** in AWS Console → click it
2. Click **"Create user pool"**
3. **Cognito user pool sign-in options:** Check **Email**
4. Click **Next**
5. **Password policy:** Use Cognito defaults → Next
6. **Multi-factor authentication:** Optional (recommended: set to Optional so your team can enable it but aren't forced to) → Next
7. **Email delivery:** Send email with Cognito (default — fine for now; switch to SES in production) → Next
8. **User pool name:** `kb-users`
9. **Hosted authentication pages:** Check **"Use the Cognito Hosted UI"**
10. **Domain:** Choose **"Use a Cognito domain"** → type a prefix like `kb-auth-itay` → full domain will be `https://kb-auth-itay.auth.us-east-1.amazoncognito.com`
11. **Initial app client:**
    - App type: **Confidential client**
    - App client name: `kb-web-client`
    - Client secret: Generate a client secret
    - **Allowed callback URLs:** `https://kb.yourdomain.com/auth/callback`
    - **Allowed sign-out URLs:** `https://kb.yourdomain.com/login`
    - **Identity providers:** Cognito user pool (leave checked; you'll add Google next)
    - **OAuth 2.0 grant types:** Authorization code grant
    - **OpenID Connect scopes:** OpenID, Email, Profile
12. Click **Next** → **Create user pool**

**Now add Google as an identity provider:**

1. Click into your `kb-users` user pool
2. Left menu: **Sign-in experience** tab → scroll to **"Federated identity provider sign-in"** → click **"Add an identity provider"**
3. Choose **Google**
4. **Client ID:** paste the Google Client ID you copied earlier
5. **Client secret:** paste the Google Client secret
6. **Authorized scopes:** `profile email openid`
7. **Map attributes:** scroll to the mapping table and ensure:
   - Google attribute `email` maps to Cognito attribute `email`
   - Google attribute `name` maps to Cognito attribute `name`
8. Click **Add identity provider**

**Now go back to Google Console and add the Cognito redirect URI:**

1. Back in Google Console → APIs & Services → Credentials → click on your OAuth client
2. Under **Authorized redirect URIs**, click **Add URI** and enter:
   `https://kb-auth-itay.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
3. Click **Save**

**Update the Cognito app client to include Google:**

1. Back in Cognito → your user pool → **App clients** tab → click `kb-web-client`
2. Find the **Hosted UI** section → click **Edit**
3. Under **Identity providers**: also check **Google**
4. Click **Save changes**

To test: open `https://kb-auth-itay.auth.us-east-1.amazoncognito.com/login?client_id=YOUR-CLIENT-ID&response_type=code&scope=email+openid+profile&redirect_uri=https://kb.yourdomain.com/auth/callback` in your browser — you should see a "Sign in with Google" button.

---

## Step 18 — First Manual Deploy (Smoke Test)

Before automating with GitLab CI, deploy manually once to confirm all the pieces connect.

**On your local machine**, inside your project folder:

```bash
# 1. Make sure your local AWS CLI is configured
# (If not: run `aws configure` and enter your itay-admin access key, secret, region=us-east-1)
aws sts get-caller-identity   # Should print your account info

# 2. Build your Docker image
docker build -t kb-app .

# 3. Authenticate with ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  YOUR-ACCOUNT-ID.dkr.ecr.us-east-1.amazonaws.com

# 4. Tag the image
docker tag kb-app:latest \
  YOUR-ACCOUNT-ID.dkr.ecr.us-east-1.amazonaws.com/kb-app:latest

# 5. Push to ECR
docker push YOUR-ACCOUNT-ID.dkr.ecr.us-east-1.amazonaws.com/kb-app:latest
```

**On the EC2 instance** (connect via EC2 Instance Connect or SSM):

```bash
# 1. Authenticate with ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin \
  YOUR-ACCOUNT-ID.dkr.ecr.us-east-1.amazonaws.com

# 2. Pull the image
docker pull YOUR-ACCOUNT-ID.dkr.ecr.us-east-1.amazonaws.com/kb-app:latest

# 3. Run the container
docker run -d \
  --name kb-app \
  --restart=always \
  -p 8000:8000 \
  -e AWS_REGION=us-east-1 \
  -e SECRET_NAME=kb-app/prod \
  YOUR-ACCOUNT-ID.dkr.ecr.us-east-1.amazonaws.com/kb-app:latest

# 4. Check it's running
docker ps
docker logs kb-app

# 5. Quick local test
curl http://localhost:8000/api/health
# Should return: {"status":"ok"}
```

**Verify the full chain:**
1. In EC2 → Target Groups → `kb-ec2-targets` → Targets tab — your instance should show **Healthy** (wait 1–2 minutes)
2. Open `https://kb.yourdomain.com` in your browser — you should see your app
3. If you see a security error, CloudFront may still be deploying (check status in CloudFront console)

---

## Step 19 — Set Up GitLab CI/CD

Now you'll automate deploys so every push to `main` builds, tests, and deploys automatically.

### 19a — Add Variables to GitLab

1. Open your GitLab repo → **Settings** (left sidebar) → **CI/CD** → expand **Variables**
2. Click **"Add variable"** for each of these:

| Key | Value | Protected | Masked |
|-----|-------|-----------|--------|
| `AWS_ACCESS_KEY_ID` | The `gitlab-ci` user's access key ID | ✓ | ✗ |
| `AWS_SECRET_ACCESS_KEY` | The `gitlab-ci` user's secret key | ✓ | ✓ |
| `AWS_REGION` | `us-east-1` | ✗ | ✗ |
| `ECR_REPO` | `YOUR-ACCOUNT-ID.dkr.ecr.us-east-1.amazonaws.com/kb-app` | ✗ | ✗ |
| `EC2_INSTANCE_ID` | Your EC2 instance ID (e.g. `i-0abc123def456`) | ✓ | ✗ |

For each variable: type the Key, paste the Value, check Protected if indicated, check Masked if indicated, then click **Add variable**.

### 19b — Add the Pipeline File

In the root of your project, create a file called `.gitlab-ci.yml` with this content:

```yaml
stages:
  - test
  - build
  - push
  - deploy

variables:
  DOCKER_DRIVER: overlay2
  IMAGE_TAG: $CI_COMMIT_SHORT_SHA

# ── STAGE 1: TEST ──────────────────────────────────────────────────
test-backend:
  stage: test
  image: python:3.12-slim
  script:
    - pip install -r requirements.txt --quiet
    - pytest tests/ -v --tb=short
  only:
    - main
    - merge_requests

test-frontend:
  stage: test
  image: node:20-alpine
  script:
    - cd frontend
    - npm ci --silent
    - npm run test -- --watchAll=false --passWithNoTests
  only:
    - main
    - merge_requests

# ── STAGE 2: BUILD ─────────────────────────────────────────────────
build:
  stage: build
  image: docker:24-cli
  services:
    - docker:24-dind
  variables:
    DOCKER_TLS_CERTDIR: "/certs"
  before_script:
    - apk add --no-cache aws-cli
    - aws ecr get-login-password --region $AWS_REGION |
        docker login --username AWS --password-stdin $ECR_REPO
  script:
    - docker build -t $ECR_REPO:$IMAGE_TAG -t $ECR_REPO:latest .
    - docker push $ECR_REPO:$IMAGE_TAG
    - docker push $ECR_REPO:latest
  only:
    - main

# ── STAGE 3: DEPLOY ────────────────────────────────────────────────
deploy:
  stage: deploy
  image: python:3.12-slim
  before_script:
    - pip install awscli --quiet
  script:
    - |
      COMMAND_ID=$(aws ssm send-command \
        --region $AWS_REGION \
        --instance-ids $EC2_INSTANCE_ID \
        --document-name "AWS-RunShellScript" \
        --parameters "commands=[
          'aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REPO',
          'docker pull $ECR_REPO:latest',
          'docker stop kb-app || true',
          'docker rm kb-app || true',
          'docker run -d --name kb-app --restart=always -p 8000:8000 -e AWS_REGION=$AWS_REGION -e SECRET_NAME=kb-app/prod $ECR_REPO:latest',
          'sleep 5 && docker ps | grep kb-app && echo DEPLOY_SUCCESS'
        ]" \
        --query "Command.CommandId" \
        --output text)
      echo "SSM Command ID: $COMMAND_ID"
      sleep 15
      aws ssm get-command-invocation \
        --region $AWS_REGION \
        --command-id $COMMAND_ID \
        --instance-id $EC2_INSTANCE_ID \
        --query "Status" \
        --output text
  only:
    - main
  needs:
    - build
```

### 19c — Add a Dockerfile (if you don't have one)

At the root of your project, create `Dockerfile`:

```dockerfile
# ── Stage 1: Build React frontend ──────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --silent
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python backend + static files ─────────────────────────
FROM python:3.12-slim
WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./backend/

# Copy built React files from stage 1
COPY --from=frontend-build /app/frontend/build ./static/

# Expose port
EXPOSE 8000

# Start the app
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```

### 19d — Test the pipeline

```bash
# Commit and push to main
git add .gitlab-ci.yml Dockerfile
git commit -m "feat: add CI/CD pipeline and Dockerfile"
git push origin main
```

In GitLab, go to **CI/CD → Pipelines** — you should see a pipeline running with 4 stages. Click into it to watch each stage's logs.

A successful pipeline looks like:
- `test-backend` ✅
- `test-frontend` ✅
- `build` ✅ (pushes image to ECR)
- `deploy` ✅ (SSM command returns `Success`)

---

## Step 20 — Verify Everything Works End-to-End

Run through this checklist after completing all steps:

### AWS checks

```bash
# From your local terminal — confirm each of these
aws ec2 describe-instances --instance-ids YOUR-INSTANCE-ID \
  --query "Reservations[0].Instances[0].State.Name" --output text
# Expected: running

aws rds describe-db-instances --db-instance-identifier kb-postgres \
  --query "DBInstances[0].DBInstanceStatus" --output text
# Expected: available

aws elasticache describe-cache-clusters --cache-cluster-id kb-redis \
  --query "CacheClusters[0].CacheClusterStatus" --output text
# Expected: available
```

### Application checks

```bash
# Health endpoint via your domain
curl https://kb.yourdomain.com/api/health
# Expected: {"status":"ok"}

# Check CloudFront is caching static assets correctly
curl -I https://kb.yourdomain.com/static/js/main.chunk.js
# Look for: X-Cache: Hit from cloudfront (after first request)
```

### Auth check
Open `https://kb.yourdomain.com` in an incognito window. You should be redirected to Google login. Sign in with your Google account. You should land on the knowledge base app.

### Database connection check (from EC2)
```bash
# SSH into EC2 or use SSM
docker exec -it kb-app python -c "
import psycopg2, boto3, json
secrets = boto3.client('secretsmanager', region_name='us-east-1').get_secret_value(SecretId='kb-app/prod')
creds = json.loads(secrets['SecretString'])
conn = psycopg2.connect(host=creds['DB_HOST'], database=creds['DB_NAME'], user=creds['DB_USER'], password=creds['DB_PASSWORD'])
print('DB connection: OK')
conn.close()
"
```

### GitLab CI check
Push a small change to `main` and watch the pipeline:
```bash
echo "# test" >> README.md
git add README.md && git commit -m "test: verify CI pipeline" && git push origin main
```

Go to GitLab → CI/CD → Pipelines — confirm all 4 stages pass.

---

## Quick Reference — All Your Saved Values

Fill this in as you go through the steps:

| Item | Your Value |
|------|-----------|
| AWS Account ID | |
| AWS Console URL | |
| EC2 Instance ID | |
| EC2 Public IP | |
| RDS Endpoint | |
| ECR Repository URI | |
| ElastiCache Endpoint | |
| S3 Bucket Name | |
| ALB DNS Name | |
| CloudFront Domain | |
| Cognito User Pool ID | |
| Cognito App Client ID | |
| Cognito Domain | |
| SSL Certificate ARN | |
| App URL | https://kb.yourdomain.com |

---

## Common Errors and Fixes

**"UnauthorizedOperation" in GitLab CI deploy stage**
→ The `gitlab-ci` IAM user is missing the SSM policy. Re-check Step 3b and make sure the inline policy was saved.

**EC2 target shows "Unhealthy" in ALB**
→ The `/api/health` endpoint doesn't exist yet. Add it to your FastAPI app and redeploy. Also check the security group: ALB security group (`sg-alb`) must be the source in EC2 security group (`sg-ec2`) on port 8000.

**CloudFront shows 502 or 504**
→ The ALB can't reach EC2. Check `sg-ec2` inbound rules. Also verify Docker is running: `docker ps` on the EC2 instance.

**"Login Succeeded" but app shows 500 error**
→ The app can't read secrets. Make sure the EC2 IAM role (`ec2-kb-app-role`) has `SecretsManagerReadWrite` attached. Check `docker logs kb-app` for the actual error.

**Google login redirects to an error page**
→ The Cognito redirect URI in Google Console doesn't match exactly. Double-check it includes `https://` and ends in `/oauth2/idpresponse`.

**RDS connection refused**
→ The security group `sg-rds` doesn't allow `sg-ec2`. Also confirm RDS is in private subnets, not public.
