plugins {
  id("org.jetbrains.intellij") version "1.17.4"
  kotlin("jvm") version "1.9.25"
}

group = "com.mam.ide"
version = providers.gradleProperty("pluginVersion").get()

repositories {
  mavenCentral()
}

dependencies {
  implementation(kotlin("stdlib"))
}

intellij {
  pluginName.set("mam-language-jetbrains")
  type.set(providers.gradleProperty("platformType").get())
  version.set(providers.gradleProperty("platformVersion").get())
  downloadSources.set(true)
}

patchPluginXml {
  sinceBuild.set(providers.gradleProperty("sinceBuild").get())
  untilBuild.set(providers.gradleProperty("untilBuild").get())
}

tasks {
  buildSearchableOptions {
    enabled = false
  }
  runIde {
    jvmArgs("-Xmx2G")
  }
}