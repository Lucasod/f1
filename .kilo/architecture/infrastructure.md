# Infrastructure Architecture - FS-01 Marketplace

## Deployment Model
Separate frontend/backend deploy per Stage 7 (CD-053). Container-based with Docker Compose for dev.

## Cloud Provider
AWS (recommended for Brazil region, Stripe Connect compatibility)

## Backend Services (ECS Fargate / App Runner)
| Service | Spec | Config |
|---------|------|--------|
| API | 2+ tasks, 1 vCPU, 2GB RAM | Auto-scaling (CPU > 70%) |
| Worker (async jobs) | 1+ tasks | SQS consumer for emails, ES sync, transfers |

## Databases
| Database | Service | Config |
|----------|---------|--------|
| MongoDB | DocumentDB / Atlas | 3-node replica set, encryption at rest, backup |
| Elasticsearch | OpenSearch Service | 3 data nodes, dedicated master, encryption |
| Redis | ElastiCache | Cluster mode, 2 shards, multi-AZ |

## Storage
| Storage | Service | Config |
|---------|---------|--------|
| Product/Review images | S3 | Versioning, CloudFront CDN, signed URLs |
| Invoices | S3 | Separate bucket, lifecycle to Glacier |

## Networking
- VPC with public/private subnets (2 AZs)
- ALB for API (HTTPS, WAF)
- NAT Gateway for outbound
- Security groups: least privilege
- VPC endpoints for S3, DynamoDB

## Secrets & Config
- AWS Secrets Manager: DB passwords, JWT secret, Stripe keys
- Parameter Store: Non-secret config
- Environment-specific values

## Monitoring & Alerting (preview - detailed in observability.md)
- CloudWatch: Metrics, logs, alarms
- X-Ray: Distributed tracing

## Dev Environment
Docker Compose (root, backend, frontend) per CD-053:
- Backend compose: API + MongoDB + Elasticsearch + Redis
- Frontend compose: React dev server
- Root compose: Full stack

## IaC
Terraform (recommended) or AWS CDK for reproducible infrastructure.