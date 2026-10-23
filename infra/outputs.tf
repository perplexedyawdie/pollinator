output "site_url" {
  description = "Open this to use Pollinator."
  value       = "https://${aws_cloudfront_distribution.site.domain_name}"
}

output "api_url" {
  value = aws_apigatewayv2_api.http.api_endpoint
}

output "data_bucket" {
  value = aws_s3_bucket.data.id
}
