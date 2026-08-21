plugins {
    java
    application
    id("com.gradleup.shadow") version "9.6.1"
}

group = "com.mastermind.minecraft"
version = "0.1.0"

java { toolchain { languageVersion = JavaLanguageVersion.of(25) } }

repositories {
    mavenCentral()
    maven("https://maven.2b2t.vc/releases")
    maven("https://maven.2b2t.vc/remote")
}

dependencies {
    implementation("com.github.rfresh2:MCProtocolLib:26.2.0.10")
    implementation("com.google.code.gson:gson:2.13.2")
    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

application {
    mainClass = "com.mastermind.minecraft.zenith.controller.HeadlessControllerMain"
}

tasks.test { useJUnitPlatform() }

tasks.shadowJar {
    archiveClassifier = "all"
    filesMatching("META-INF/services/**") {
        duplicatesStrategy = DuplicatesStrategy.INCLUDE
    }
    mergeServiceFiles()
    manifest { attributes["Main-Class"] = application.mainClass.get() }
}
