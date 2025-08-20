const chunk_size = 16384
const max_buffer = 16006707

const main = document.querySelector('article main')
const fileInput = document.querySelector('#fileInput')
const PBAR = document.querySelector('#progress')
const progressInfo = document.querySelector('#progressInfo')
const LOCATION = new URL(location.href)
const params = new URLSearchParams(LOCATION.search)
const rid = params.get('code')
window.history.replaceState({}, document.title, LOCATION.pathname)

let connection = null,
    filebuffer,
    received,
    ts

let peer = new Peer()
    .on('open', () => {
        console.log('PEER OPEN')
        if (rid) onConnection(peer.connect(rid, { reliable: true }))
        else appendQRCode(`${LOCATION.origin + LOCATION.pathname}?code=${peer.id}`, peer.id)
    })
    .on('connection', onConnection)

;(async () => {
    if (!navigator.wakeLock) return
    await navigator.wakeLock.request('screen')
})()

function onConnection(conn) {
    main.replaceChildren()
    connection = conn
        .on('open', () => {
            fileInput.disabled = false
            console.log('CONNECTION ESTABLISHED')
        })
        .on('close', () => {
            fileInput.disabled = true
            console.log('CONNECTION CLOSED')
        })
        .on('error', (error) => {
            fileInput.disabled = true
            console.log('CONNECTION ERROR:')
            console.log(error)
        })
        .on('data', dataHandler)
}

async function dataHandler(data) {
    if (!data.event && filebuffer != null) chunkHandler(data)
    else if (data.event == 'file_offer') {
        fileinfo = data.fileinfo
        connection.send({ event: 'file_answer' })
    } else if (data.event == 'file_answer') {
        connection.send({ event: 'file_start' })
        fileInput.disabled = true
        sendFile()
    } else if (data.event == 'file_start') {
        filebuffer = []
        received = 0
        ts = Date.now()
        fileInput.disabled = true
    } else if (data.event == 'file_end') {
        fileInput.disabled = false
    }
}

function sendFile() {
    let start = 0
    let index = 0
    const file = fileInput.files[0]
    while (start < file.size) {
        if (connection.dataChannel.bufferedAmount > max_buffer) continue
        connection.send({ index, chunk: file.slice(start, (start += chunk_size + 1)) })
        const progress = Math.round((start / file.size) * 100)
        PBAR.style.width = progress + '%'
        const ptext = `${formatBytes(start)} / ${formatBytes(file.size)}`
        progressInfo.textContent = ptext
        index++
    }
}

function chunkHandler(data) {
    received += data.chunk.byteLength

    const progress = Math.round((received / fileinfo.size) * 100)
    PBAR.style.width = progress + '%'
    const bitrate = formatBytes(Math.round(received / (Date.now() - ts)) * 1000) + '/s'
    const ptext = `${formatBytes(received)} / ${formatBytes(fileinfo.size)} - ${bitrate}`
    progressInfo.textContent = ptext

    // filebuffer.push(data)
    filebuffer[data.index] = data.chunk

    if (received == fileinfo.size) {
        const a = document.createElement('a')
        a.role = 'button'
        a.textContent = fileinfo.name
        a.download = fileinfo.name
        a.href = href = URL.createObjectURL(new Blob(filebuffer, { type: fileinfo.type }))
        main.append(a)
        filebuffer = null
        connection.send({ event: 'file_end' })
        fileInput.disabled = false
    }
}

fileInput.addEventListener('change', () => {
    if (!connection) return
    if (!fileInput.files.length) return
    const file = fileInput.files[0]
    connection.send({ event: 'file_offer', fileinfo: { name: file.name, size: file.size, type: file.type } })
})

function appendQRCode(text, tooltip = null) {
    const code = document.createElement('div')
    code.id = 'code'
    if (tooltip) {
        code.setAttribute('data-tooltip', tooltip)
        code.setAttribute('data-placement', 'bottom')
    }
    code.addEventListener('click', () => {
        navigator.clipboard?.writeText(tooltip)
    })
    new QRCode(code, {
        text,
        width: 256,
        height: 256,
        colorDark: '#181c25',
        colorLight: '#fff',
        correctLevel: QRCode.CorrectLevel.H,
    })
    code.title = ''
    main.replaceChildren(code)
}

function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const dm = Math.max(0, decimals)
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    // return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
    return (bytes / Math.pow(k, i)).toFixed(dm) + ' ' + sizes[i]
}
