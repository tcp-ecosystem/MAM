Gem::Specification.new do |spec|
  spec.name = "mam-sdk-ruby"
  spec.version = "0.1.0"
  spec.summary = "Dependency-free Ruby SDK for Markdown as Module files"
  spec.authors = ["MAM maintainers"]
  spec.files = Dir["lib/**/*.rb", "README.md", "task.md", "update.md"]
  spec.require_paths = ["lib"]
  spec.required_ruby_version = ">= 3.0"
end
