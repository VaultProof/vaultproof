function copyCmd(btn, text) {
    navigator.clipboard.writeText(text).then(function() {
        var svg = btn.innerHTML;
        btn.innerHTML = '<svg class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>';
        setTimeout(function() { btn.innerHTML = svg; }, 1500);
    });
}
