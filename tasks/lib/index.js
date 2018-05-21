'use strict';

var ejs = require('ejs');
var exec;
var dateformat = require('dateformat');
var crypto = require('crypto');
var async = require('async');
var file = require('fs');

ejs.open = "{{";
ejs.close = "}}";

var cwd = __dirname;

var createFile = function (template, options) {
    var outerMetadata = file.readFileSync(cwd + '/../template/' + template, {encoding: 'utf-8'});
    var metadata = ejs.render(outerMetadata, options);
    return metadata;
};

var md5 = function (str) {
    var hash = crypto.createHash('md5');
    return hash.update(str).digest('hex');
};

var sha1 = function (str) {
    var hash = crypto.createHash('sha1');
    return hash.update(str).digest('hex');
};

var save = function (fileContent, pomDir, fileName) {
    file.writeFileSync(pomDir + '/' + fileName, fileContent);
    file.writeFileSync(pomDir + '/' + fileName + '.md5', md5(fileContent));
    file.writeFileSync(pomDir + '/' + fileName + '.sha1', sha1(fileContent));
};

var createAndUploadArtifacts = function (options, cb) {
    var pomDir = options.pomDir || 'test/poms';

    options.parallel = options.parallel === undefined ? false : options.parallel;
    if (!file.existsSync(pomDir)) {
        file.mkdirSync(pomDir);
    }

    save(createFile('project-metadata.xml', options), pomDir, 'outer.xml');
    save(createFile('latest-metadata.xml', options), pomDir, 'inner.xml');
    save(createFile('pom.xml', options), pomDir, 'pom.xml');

    var artifactData = file.readFileSync(options.artifact, {encoding: 'binary'});
    file.writeFileSync(pomDir + '/artifact.' + options.packaging + '.md5', md5(artifactData));
    file.writeFileSync(pomDir + '/artifact.' + options.packaging + '.sha1', sha1(artifactData));

    var upload = function (fileLocation, targetFile) {
        var uploadArtifact = function (cb) {
            var targetUri = options.url + '/' + targetFile, status;
            if (!options.quiet) {
                console.log('Uploading to ' + targetUri + "\n\n");
            }

            var curlOptions = [
                '--silent',
                '--output', '/dev/null',
                '--write-out', '"%{http_code}"',
                '--upload-file', fileLocation,
                '--noproxy', options.noproxy ? options.noproxy : '127.0.0.1'
            ];

            if (options.auth) {
                curlOptions.push('-u');
                curlOptions.push(options.auth.username + ":" + options.auth.password);
            }

            if (options.insecure) {
                curlOptions.push('--insecure');
            }

            var execOptions = {};
            options.cwd && (execOptions.cwd = options.cwd);

            var curlCmd = ['curl', curlOptions.join(' '), targetUri].join(' ');

            var childProcess = exec(curlCmd, execOptions, function () {
            });
            childProcess.stdout.on('data', function (data) {
                status = data;
            });
            childProcess.on('exit', function (code) {
                if (code !== 0 || (status !== "200" && status !== "201")) {
                    cb("Status code " + status + " for " + targetUri, null);
                } else {
                    cb(null, "Ok");
                }
            });
        };
        return uploadArtifact;
    };

    var uploads = {};

    var groupIdAsPath = options.groupId.replace(/\./g, "/");
    var groupArtifactPath = groupIdAsPath + '/' + options.artifactId;

    uploads[pomDir + "/outer.xml"] = groupArtifactPath + '/' + 'maven-metadata.xml';
    uploads[pomDir + "/outer.xml.sha1"] = groupArtifactPath + '/' + 'maven-metadata.xml.sha1';
    uploads[pomDir + "/outer.xml.md5"] = groupArtifactPath + '/' + 'maven-metadata.xml.md5';

    var SNAPSHOT_VER = /.*SNAPSHOT$/i;

    var groupArtifactVersionPath = groupArtifactPath + '/' + options.version;
    if (SNAPSHOT_VER.test(options.version)) {
        uploads[pomDir + "/inner.xml"] = groupArtifactVersionPath + '/' + 'maven-metadata.xml';
        uploads[pomDir + "/inner.xml.sha1"] = groupArtifactVersionPath + '/' + 'maven-metadata.xml.sha1';
        uploads[pomDir + "/inner.xml.md5"] = groupArtifactVersionPath + '/' + 'maven-metadata.xml.md5';
    }

    var remoteArtifactName = options.artifactId + '-' + options.version;
    uploads[pomDir + "/pom.xml"] = groupArtifactVersionPath + '/' + remoteArtifactName + '.pom';
    uploads[pomDir + "/pom.xml.sha1"] = groupArtifactVersionPath + '/' + remoteArtifactName + '.pom.sha1';
    uploads[pomDir + "/pom.xml.md5"] = groupArtifactVersionPath + '/' + remoteArtifactName + '.pom.md5';


    if(options.classifier) {
        remoteArtifactName = remoteArtifactName + "-" + options.classifier;
    }
    uploads[options.artifact] = groupArtifactVersionPath + '/' + remoteArtifactName + '.' + options.packaging;
    uploads[pomDir + "/artifact." + options.packaging + ".sha1"] = groupArtifactVersionPath + '/' + remoteArtifactName + '.' + options.packaging + '.sha1';
    uploads[pomDir + "/artifact." + options.packaging + ".md5"] = groupArtifactVersionPath + '/' + remoteArtifactName + '.' + options.packaging + '.md5';


    var fns = [];
    for (var u in uploads) {
        if (uploads.hasOwnProperty(u)) {
            fns.push(upload(u, uploads[u]));
        }
    }

    var asyncFn = options.parallel ? async.parallel : async.series;
    asyncFn(fns, function (err) {
        if (!options.quiet) {
            console.log('-------------------------------------------\n');
            if (err) {
                console.log('Artifact Upload failed\n' + String(err));
            } else {
                console.log('Artifacts uploaded successfully');
                cb();
            }
        }
    });
};

module.exports = function (options, cb) {
    if (!options) {
        throw {name: "IllegalArgumentException", message: "upload artifact options required."};
    }
    exec = process.env.MOCK_NEXUS ? require('./mockexec') : require('child_process').exec;
    options.lastUpdated = dateformat(new Date(), "yyyymmddHHMMss");
    createAndUploadArtifacts(options, cb);
};
