plugins {
    java
    application
}

group = "com.mastermind.minecraft"
version = "0.1.0"

java { toolchain { languageVersion = JavaLanguageVersion.of(25) } }

repositories { mavenCentral() }

dependencies {
    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

application {
    mainClass = "com.mastermind.minecraft.zenith.bootstrap.SecureZenithBootstrapMain"
}

tasks.test { useJUnitPlatform() }

tasks.jar {
    manifest { attributes["Main-Class"] = application.mainClass.get() }
}
