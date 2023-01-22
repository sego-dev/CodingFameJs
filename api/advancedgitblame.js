const shell = require('shelljs')
var BlameJS = require("blamejs")
const fg = require('fast-glob')
const minimatch = require('minimatch')

function extractFiles (file) {
  if (file["children"].length === 0) {
    return [file.path]
  } else {
    let files = [];
    file.children.forEach((child) => {
      files = files.concat(extractFiles(child));
    })
    return files
  }
}

function createNode (path, tree, fullpath, repo, currentPath = null) {
  const name = path.shift()
  const idx = tree.findIndex(function (e) {
    return e.name == name
  })
  if (currentPath === null) {
    currentPath = `${repo}/${name}`
  } else {
    currentPath += `/${name}`
  }
  if (idx < 0) {
    if (name) {
      tree.push({
        name,
        children: [],
        path: currentPath,
        repo
      })
    }
    if (path.length !== 0) {
      if (name) {
        createNode(path, tree[tree.length - 1].children, fullpath, repo, currentPath)
      }
    }
  } else if (name) {
    createNode(path, tree[idx].children, fullpath, repo, currentPath)
  }
}

function parse (data, repo) {
  const tree = []
  for (let i = 0; i < data.length; i++) {
    const path = data[i]
    const split = path.replace(repo, '').split('/').filter(x => x !== '')
    createNode(split, tree, path, repo)
  }
  return tree
}

export default async function (req, res, _) {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.searchParams.get('repopath') == null) {
    res.end()
    return
  }

  let output = [];

  let repopath = url.searchParams.get('repopath');
  let ignores = url.searchParams.get('ignores') ? url.searchParams.get('ignores').split(',') : [];

  let files = [];

  const result = await fg([repopath + '/**/*'], { dot: true })
  const repotree = parse(result, repopath)
  repotree.forEach((file) => {
      files = files.concat(extractFiles(file))
  });

  var blamejs = new BlameJS();   
  let authors = new Map();

  files.filter((file) => !(fileExcluded(file))).forEach((file) => {
    let dirpath = file.split('/');
    const filename = dirpath.pop();
    dirpath = dirpath.join('/');
    let ext = filename.split('.').pop()

    const gitblame = shell.exec(`cd ${dirpath} && git blame ${filename} -p`, { silent: true }).stdout;
    blamejs.parseBlame(gitblame);
    var commitData = blamejs.getCommitData();
    var lineData = blamejs.getLineData();

    for (let ind in lineData) {
      let author = commitData[lineData[ind].hash]["authorMail"];
      if (authors.get(author)) {
        if (authors.get(author).get(ext)) {
            authors.get(author).set(ext, authors.get(author).get(ext) + 1)
        } else {
            authors.get(author).set(ext, 1)
        }
        authors.get(author).set('.all', authors.get(author).get('.all') + 1)
      } else {
        let newAuthor = new Map()
        newAuthor.set(ext, 1)
        newAuthor.set('.all', 1)
        authors.set(author, newAuthor)
      }
    }
  })

  for (let author of authors.keys()) {
    authors.set(author, Object.fromEntries(authors.get(author).entries()))
  }

  output = Object.fromEntries(authors.entries());
  res.write(JSON.stringify(output))
  res.end()

  function fileExcluded(filepath) {
    for (let i = 0; i < ignores.length; i++) {
      const ignorePattern = ignores[i]
      if (minimatch(filepath, ignorePattern, { matchBase: true })) {
        return true
      }
    }
    return false
  }
}
  