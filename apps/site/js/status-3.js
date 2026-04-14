(async () => {
                const canvas = document.getElementById('mapCanvas');
                const ctx = canvas.getContext('2d');

                // Hi-DPI support
                const dpr = window.devicePixelRatio || 1;
                const rect = canvas.getBoundingClientRect();
                canvas.width = rect.width * dpr;
                canvas.height = rect.height * dpr;
                ctx.scale(dpr, dpr);
                const W = rect.width, H = rect.height;

                // Simple Equirectangular projection
                function project(lng, lat) {
                    const x = (lng + 180) / 360 * W;
                    const y = (90 - lat) / 180 * H;
                    return [x, y];
                }

                // Load and draw country outlines
                try {
                    const res = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json');
                    const world = await res.json();
                    const countries = topojson.feature(world, world.objects.countries).features;

                    ctx.fillStyle = '#12121f';
                    ctx.fillRect(0, 0, W, H);

                    // Draw countries
                    countries.forEach(country => {
                        const geom = country.geometry;
                        const coords = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
                        coords.forEach(polygon => {
                            polygon.forEach(ring => {
                                ctx.beginPath();
                                ring.forEach((pt, i) => {
                                    const [x, y] = project(pt[0], pt[1]);
                                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                                });
                                ctx.closePath();
                                ctx.fillStyle = '#1a1a2e';
                                ctx.fill();
                                ctx.strokeStyle = '#252540';
                                ctx.lineWidth = 0.4;
                                ctx.stroke();
                            });
                        });
                    });
                } catch {
                    // Fallback: just draw background
                    ctx.fillStyle = '#12121f';
                    ctx.fillRect(0, 0, W, H);
                }

                // 330+ edge locations
                const nodes = [
                    // North America
                    [37.77,-122.42],[34.05,-118.24],[47.61,-122.33],[33.45,-112.07],[39.74,-104.99],
                    [32.78,-96.80],[29.76,-95.37],[30.27,-97.74],[41.88,-87.63],[42.36,-71.06],
                    [40.71,-74.01],[38.91,-77.04],[25.76,-80.19],[33.75,-84.39],[35.23,-80.84],
                    [36.17,-115.14],[44.98,-93.27],[39.10,-94.58],[29.95,-90.07],[43.65,-79.38],
                    [45.50,-73.57],[49.28,-123.12],[51.05,-114.07],[53.55,-113.49],[19.43,-99.13],
                    [20.63,-87.08],[14.64,-90.51],[9.93,-84.09],[8.98,-79.52],[18.47,-69.90],
                    [21.31,-157.86],[61.22,-149.90],[46.81,-71.21],[32.32,-64.76],
                    // Europe
                    [51.51,-0.13],[48.86,2.35],[52.52,13.41],[50.11,8.68],[48.14,11.58],
                    [47.37,8.54],[52.37,4.90],[50.85,4.35],[59.33,18.07],[60.17,24.94],
                    [59.91,10.75],[55.68,12.57],[40.42,-3.70],[41.39,2.17],[38.72,-9.14],
                    [41.01,28.98],[37.98,23.73],[45.46,9.19],[41.90,12.50],[48.21,16.37],
                    [50.08,14.44],[52.23,21.01],[47.50,19.04],[46.06,14.51],[44.43,26.10],
                    [42.70,23.32],[53.35,-6.26],[55.95,-3.19],[64.14,-21.90],[54.69,25.28],
                    [56.95,24.11],[59.44,24.75],[44.82,20.46],[43.86,18.41],[42.44,19.26],
                    // Asia Pacific
                    [35.68,139.69],[34.69,135.50],[1.35,103.82],[22.40,114.11],[25.03,121.57],
                    [37.57,126.98],[14.60,120.98],[13.76,100.50],[21.03,105.85],[3.14,101.69],
                    [-6.21,106.85],[28.61,77.21],[19.08,72.88],[12.97,77.59],[13.08,80.27],
                    [17.39,78.49],[22.57,88.36],[23.81,90.41],[27.72,85.32],[6.93,79.85],
                    [33.69,73.04],[31.55,74.35],[24.87,67.01],[39.92,116.46],[31.23,121.47],
                    [22.54,114.06],[23.13,113.26],[30.57,104.07],[-33.87,151.21],[-37.81,144.96],
                    [-27.47,153.03],[-31.95,115.86],[-36.85,174.76],[-41.29,174.78],
                    [16.87,96.20],[11.56,104.92],
                    // Middle East
                    [25.21,55.27],[24.45,54.65],[26.07,50.56],[25.29,51.53],[23.59,58.38],
                    [29.38,47.99],[33.31,44.37],[31.95,35.93],[33.89,35.50],[40.18,44.51],
                    // Africa
                    [-33.93,18.42],[-26.20,28.05],[6.52,3.38],[5.56,-0.19],[-1.29,36.82],
                    [-6.79,39.28],[-4.32,15.31],[-15.39,28.32],[-17.83,31.05],[36.75,3.06],
                    [33.59,-7.62],[34.02,-6.84],[30.03,31.23],[9.02,38.75],[14.72,-17.47],
                    [12.37,-1.52],[-18.91,47.52],[-20.16,57.50],[0.35,32.60],[15.50,32.56],
                    // South America
                    [-23.55,-46.63],[-22.91,-43.17],[-15.79,-47.88],[-3.72,-38.53],
                    [-30.03,-51.23],[-34.60,-58.38],[-33.45,-70.67],[-12.05,-77.04],
                    [4.71,-74.07],[10.49,-66.88],[-2.17,-79.92],[-17.78,-63.18],
                    [-25.26,-57.58],[-34.91,-56.19],[6.80,-58.16],[5.84,-55.17],
                ];

                // Pre-project all node positions
                const projected = nodes.map(([lat, lng]) => project(lng, lat));

                // Save the static map as an image so we don't redraw countries every frame
                const mapImage = ctx.getImageData(0, 0, canvas.width, canvas.height);

                // Flowing colored lines between random nodes
                const flows = [];
                const MAX_FLOWS = 60;
                const FLOW_COLORS = [
                    [34, 197, 94],    // green
                ];

                function spawnFlow(i, randomStart) {
                    const a = Math.floor(Math.random() * projected.length);
                    let b = Math.floor(Math.random() * projected.length);
                    while (b === a) b = Math.floor(Math.random() * projected.length);
                    return {
                        from: a, to: b,
                        t: randomStart ? Math.random() : 0,
                        speed: 0.001 + Math.random() * 0.006,
                        delay: randomStart ? 0 : Math.random() * 3000,
                        startTime: Date.now(),
                        color: FLOW_COLORS[i % FLOW_COLORS.length],
                    };
                }
                for (let i = 0; i < MAX_FLOWS; i++) flows.push(spawnFlow(i, true));

                function animate() {
                    ctx.putImageData(mapImage, 0, 0);
                    const now = Date.now();

                    // Draw edge nodes with subtle pulse
                    projected.forEach(([x, y], i) => {
                        const pulse = 0.15 + 0.1 * Math.sin(now / 1200 + i * 0.5);
                        ctx.beginPath();
                        ctx.arc(x, y, 3.5 + Math.sin(now / 1000 + i) * 0.5, 0, Math.PI * 2);
                        ctx.fillStyle = `rgba(99, 102, 241, ${pulse})`;
                        ctx.fill();
                        ctx.beginPath();
                        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
                        ctx.fillStyle = 'rgba(99, 102, 241, 0.85)';
                        ctx.fill();
                    });

                    // Draw flowing lines
                    flows.forEach((f, i) => {
                        // Wait for random delay before starting
                        if (now - f.startTime < f.delay) return;

                        f.t += f.speed;
                        if (f.t >= 1) {
                            Object.assign(f, spawnFlow(i, false));
                            f.delay = Math.random() * 2000;
                            f.startTime = now;
                            return;
                        }

                        const [x1, y1] = projected[f.from];
                        const [x2, y2] = projected[f.to];
                        const mx = (x1 + x2) / 2;
                        const my = Math.min(y1, y2) - 20 - Math.abs(x2 - x1) * 0.06;
                        const [r, g, b] = f.color;

                        // Draw the line progressively (0 to current t)
                        const steps = 60;
                        const headT = f.t;
                        const tailT = Math.max(0, f.t - 0.35);

                        ctx.lineCap = 'round';
                        for (let s = 0; s < steps; s++) {
                            const st = tailT + (headT - tailT) * (s / steps);
                            const et = tailT + (headT - tailT) * ((s + 1) / steps);
                            const sx = (1-st)*(1-st)*x1 + 2*(1-st)*st*mx + st*st*x2;
                            const sy = (1-st)*(1-st)*y1 + 2*(1-st)*st*my + st*st*y2;
                            const ex = (1-et)*(1-et)*x1 + 2*(1-et)*et*mx + et*et*x2;
                            const ey = (1-et)*(1-et)*y1 + 2*(1-et)*et*my + et*et*y2;

                            // Fade from tail to head
                            const alpha = 0.1 + 0.5 * (s / steps);
                            ctx.beginPath();
                            ctx.moveTo(sx, sy);
                            ctx.lineTo(ex, ey);
                            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                            ctx.lineWidth = 1.5 + (s / steps) * 1;
                            ctx.stroke();
                        }

                        // Bright dot at head
                        const hx = (1-headT)*(1-headT)*x1 + 2*(1-headT)*headT*mx + headT*headT*x2;
                        const hy = (1-headT)*(1-headT)*y1 + 2*(1-headT)*headT*my + headT*headT*y2;
                        ctx.beginPath();
                        ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
                        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.9)`;
                        ctx.fill();
                        // Glow around head
                        ctx.beginPath();
                        ctx.arc(hx, hy, 5, 0, Math.PI * 2);
                        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.15)`;
                        ctx.fill();
                    });

                    // Node count label
                    ctx.font = '11px Inter, sans-serif';
                    ctx.fillStyle = '#4b5563';
                    ctx.textAlign = 'right';
                    ctx.fillText(nodes.length + '+ edge locations', W - 16, H - 12);

                    requestAnimationFrame(animate);
                }
                animate();
            })();
