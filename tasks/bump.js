/*global module, require */
//noinspection JSLint
'use strict';

/**
 @typedef semver
 @type {object}
 */

/**
 * @property {function} semver.inc
 * @property {function} semver.valid
 */

/** @type {semver} */
var semver = require('semver'),
    /** @type {function} */
    exec = require('child_process').exec;

/**
 @param {Object} grunt
 @param {Function} grunt.config
 @param {Function} grunt.fatal
 @param {Function} grunt.file
 @param {Function} grunt.initConfig
 @param {Function} grunt.loadNpmTasks
 @param {Function} grunt.log
 @param {Function} grunt.log.ok
 @param {Function} grunt.option
 @param {Function} grunt.registerTask
 @param {Function} grunt.task
 @param {Function} grunt.task.run
 @param {Function} grunt.verbose
 @param {Function} grunt.warn
 */
module.exports = function (grunt) {
    var DESC = 'Increment the version, commit, tag and push.';
    grunt.registerTask('bumpver', DESC, function (versionType, incOrCommitOnly) {
        var done,
            dryRun,
            gitVersion,    // when bumping using `git describe`
            globalVersion, // when bumping multiple files
            next,
            opts = this.options({
                bumpVersion: true,
                commit: true,
                commitFiles: ['package.json'], // '-a' for all files
                commitMessage: 'Release v%VERSION%',
                createTag: true,
                dryRun: false,
                files: ['package.json'],
                gitCommitOptions: '',
                gitDescribeOptions: '--tags --always --abbrev=1 --dirty=-d',
                globalReplace: false,
                hgTagTemplate: '{latesttag}',
                prereleaseName: false,
                metadata: '',
                push: true,
                pushTo: 'upstream',
                regExp: false,
                setVersion: false,
                tagMessage: 'Version %VERSION%',
                tagName: 'v%VERSION%',
                updateConfigs: [], // array of config properties to update (with files)
                vcs: 'git',
                versionType: false
            }),
            queue,
            runIf,
            setVersion,
            vcs = (opts.vcs === 'hg' ? 'hg' : 'git'),
            VERSION_REGEXP;

        if (versionType === 'bump-only' || versionType === 'commit-only') {
            incOrCommitOnly = versionType;
            versionType = '';
        }
        versionType = versionType || opts.versionType;

        dryRun = grunt.option('dry-run') || opts.dryRun;

        setVersion = grunt.option('setversion') || opts.setVersion;
        if (setVersion && !semver.valid(setVersion)) {
            setVersion = false;
        }

        VERSION_REGEXP = opts.regExp || new RegExp(
                '([\'|\"]?version[\'|\"]?[ ]*:[ ]*[\'|\"]?)(\\d+\\.\\d+\\.\\d+(-' +
                opts.prereleaseName +
                '\\.\\d+)?(-\\d+)?)[\\d||A-a|.|-]*([\'|\"]?)', 'i'
            );
        if (opts.globalReplace) {
            VERSION_REGEXP = new RegExp(VERSION_REGEXP.source, 'gi');
        }

        done = this.async();
        queue = [];
        next = function () {
            if (!queue.length) {
                grunt.config.set('bump.version', globalVersion);
                return done();
            }
            queue.shift()();
        };
        runIf = function (condition, behavior) {
            if (condition) {
                queue.push(behavior);
            }
        };

        if (dryRun) {
            grunt.log.writeln('Running grunt-bump in dry mode!');
        }

        if (incOrCommitOnly === 'bump-only') {
            grunt.verbose.writeln('Only incrementing the version.');

            opts.commit = false;
            opts.createTag = false;
            opts.push = false;
        }

        if (incOrCommitOnly === 'commit-only') {
            grunt.verbose.writeln('Only committing/tagging/pushing.');

            opts.bumpVersion = false;
        }

        // GET VERSION FROM HG OR GIT
        if (opts.vcs === 'hg') {
            runIf(opts.bumpVersion && versionType === 'hg', function () {
                exec("hg parents --template " + opts.hgTagTemplate, function (err, stdout) {//-{latesttagdistance}-{node|short}
                    if (err) {
                        grunt.fatal('Cannot get a version number using `hg parents`');
                    }
                    gitVersion = stdout.trim();
                    grunt.log.writeln("gitVersion = " + gitVersion);
                    next();
                });
            });
        } else {
            runIf(opts.bumpVersion && versionType === 'git', function () {
                exec('git describe ' + opts.gitDescribeOptions, function (err, stdout) {
                    if (err) {
                        grunt.fatal('Can not get a version number using `git describe`');
                    }
                    gitVersion = stdout.trim();
                    next();
                });
            });
        }

        // BUMP ALL FILES
        runIf(opts.bumpVersion, function () {
            grunt.file.expand(opts.files).forEach(function (file, idx) {
                var cfg,
                    configProperty,
                    content,
                    logMsg,
                    version = null;
                content = grunt.file.read(file).replace(
                    VERSION_REGEXP,
                    function (match, prefix, parsedVersion, namedPre, noNamePre, suffix) {
                        var type = (versionType === 'git' || versionType === 'hg') ? 'prerelease' : versionType;
                        version = setVersion || semver.inc(
                                parsedVersion, type || 'patch', gitVersion || opts.prereleaseName
                            );
                        console.log('md', opts.metadata);
                        if (opts.metadata) {
                            if (!/^([0-9a-zA-Z\-]+\.?)*$/.test(opts.metadata)) {
                                grunt.fatal(
                                    'Metadata can only contain letters, numbers, dashes ' +
                                    '(-) and dots (.)'
                                );
                            }
                            version += '+' + opts.metadata;
                        }
                        return prefix + version + (suffix || '');
                    }
                );

                if (!version) {
                    grunt.fatal('Can not find a version to bump in ' + file);
                }

                logMsg = 'Version bumped to ' + version + ' (in ' + file + ')';
                if (!dryRun) {
                    grunt.file.write(file, content);
                    grunt.log.ok(logMsg);
                } else {
                    grunt.log.ok('bump-dry: ' + logMsg);
                }

                if (!globalVersion) {
                    globalVersion = version;
                } else if (globalVersion !== version) {
                    grunt.warn('Bumping multiple files with different versions!');
                }

                configProperty = opts.updateConfigs[idx];
                if (!configProperty) {
                    return;
                }

                cfg = grunt.config(configProperty);
                if (!cfg) {
                    return grunt.warn(
                        'Can not update "' + configProperty + '" config, it does not exist!'
                    );
                }

                cfg.version = version;
                grunt.config(configProperty, cfg);
                grunt.log.ok(configProperty + '\'s version updated');
            });
            next();
        });


        // when only committing, read the version from package.json / pkg config
        runIf(!opts.bumpVersion, function () {
            var configVersion = grunt.config.get('bump.version');

            if (configVersion) {
                globalVersion = configVersion;
            }
            else if (opts.updateConfigs.length) {
                globalVersion = grunt.config(opts.updateConfigs[0]).version;
            } else {
                globalVersion = grunt.file.readJSON(opts.files[0]).version;
            }

            next();
        });


        // COMMIT
        runIf(opts.commit, function () {
            var cmd = vcs + ' commit ' + opts.gitCommitOptions + ' ' + opts.commitFiles.join(' '),
                commitMessage = opts.commitMessage.replace(
                    '%VERSION%', globalVersion
                );
            cmd += ' -m "' + commitMessage + '"';

            if (dryRun) {
                grunt.log.ok('bump-dry: ' + cmd);
                next();
            } else {
                exec(cmd, function (err, stdout, stderr) {
                    if (err) {
                        grunt.fatal('Can not create the commit:\n  ' + stderr);
                    }
                    grunt.log.ok('Committed as "' + commitMessage + '"');
                    next();
                });
            }
        });


        // CREATE TAG
        runIf(opts.createTag, function () {
            var cmd = '',
                tagMessage = opts.tagMessage.replace('%VERSION%', globalVersion),
                tagName = opts.tagName.replace('%VERSION%', globalVersion);

            if (vcs === 'hg') {
                cmd = 'hg tag -m "' + tagMessage + '" ' + tagName;
            } else {
                cmd = 'git tag -a ' + tagName + ' -m "' + tagMessage + '"';
            }
            if (dryRun) {
                grunt.log.ok('bump-dry: ' + cmd);
                next();
            } else {
                exec(cmd, function (err, stdout, stderr) {
                    if (err) {
                        grunt.fatal('Can not create the tag:\n  ' + stderr);
                    }
                    grunt.log.ok('Tagged as "' + tagName + '"');
                    next();
                });
            }
        });


        // PUSH CHANGES
        runIf(opts.push, function () {
            var cmd,
                refCmd;

            if (opts.push === vcs && !opts.pushTo) {
                cmd = vcs + ' push';
                if (dryRun) {
                    grunt.log.ok('bump-dry: ' + cmd);
                    next();
                } else {
                    exec(cmd, function (err, stdout, stderr) {
                        if (err) {
                            grunt.fatal(
                                'Can not push to the ' + vcs + ' default settings:\n ' + stderr
                            );
                        }
                        grunt.log.ok('Pushed to the ' + vcs + ' default settings');
                        next();
                    });
                }

                return;
            }

            refCmd = 'git rev-parse --abbrev-ref HEAD';
            if (vcs === 'hg') {
                refCmd = 'hg branch';
            }
            exec(refCmd, function (err, ref, stderr) {
                var tagName;
                if (err) {
                    grunt.fatal('Can not get ref for HEAD:\n' + stderr);
                }

                cmd = [];

                if (opts.vcs === 'hg') {
                    cmd.push('hg push');
                } else {
                    if (opts.push === true || opts.push === 'branch') {
                        cmd.push('git push ' + opts.pushTo + ' ' + ref.trim());
                    }

                    if (opts.createTag && (opts.push === true || opts.push === 'tag')) {
                        tagName = opts.tagName.replace('%VERSION%', globalVersion);
                        cmd.push('git push ' + opts.pushTo + ' ' + tagName);
                    }
                }

                cmd = cmd.join(' && ');

                if (dryRun) {
                    grunt.log.ok('bump-dry: ' + cmd);
                    next();
                } else {
                    exec(cmd, function (err, stdout, stderr) {
                        if (err) {
                            grunt.fatal('Can not push to ' + opts.pushTo + ':\n  ' + stderr);
                        }
                        grunt.log.ok('Pushed to ' + opts.pushTo);
                        next();
                    });
                }
            });
        });

        next();
    });


    // ALIASES
    DESC = 'Increment the version only.';
    grunt.registerTask('bump-only', DESC, function (versionType) {
        grunt.task.run('bumpver:' + (versionType || '') + ':bump-only');
    });

    DESC = 'Commit, tag, push without incrementing the version.';
    grunt.registerTask('bump-commit', DESC, 'bumpver::commit-only');
};
