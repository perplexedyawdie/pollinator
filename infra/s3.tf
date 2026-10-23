# Transient job data: transcripts (deleted after extraction) and results.
resource "aws_s3_bucket" "data" {
  bucket_prefix = "${var.project}-data-"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    id     = "expire-jobs"
    status = "Enabled"
    filter {
      prefix = "jobs/"
    }
    expiration {
      days = 1
    }
  }
}

# Lambda deployment packages (api.zip is over the 50 MB direct-upload limit once unzipped).
resource "aws_s3_bucket" "artifacts" {
  bucket_prefix = "${var.project}-artifacts-"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_object" "lambda_zip" {
  for_each    = toset(["api", "worker"])
  bucket      = aws_s3_bucket.artifacts.id
  key         = "${each.key}.zip"
  source      = "${local.dist}/${each.key}.zip"
  source_hash = filebase64sha256("${local.dist}/${each.key}.zip")
}

# Static page, served only through CloudFront.
resource "aws_s3_bucket" "site" {
  bucket_prefix = "${var.project}-site-"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket                  = aws_s3_bucket.site.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

locals {
  content_types = {
    html = "text/html; charset=utf-8"
    js   = "text/javascript; charset=utf-8"
    css  = "text/css; charset=utf-8"
    svg  = "image/svg+xml"
    png  = "image/png"
  }
}

resource "aws_s3_object" "site" {
  for_each      = fileset(local.web, "**")
  bucket        = aws_s3_bucket.site.id
  key           = each.value
  source        = "${local.web}/${each.value}"
  etag          = filemd5("${local.web}/${each.value}")
  content_type  = lookup(local.content_types, reverse(split(".", each.value))[0], "application/octet-stream")
  cache_control = "no-cache"
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.site.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.site.arn } }
    }]
  })
}
