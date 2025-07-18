import data from "./miniflash.json" with { type: 'json' };
import { createJSONEditor } from 'https://cdn.jsdelivr.net/npm/vanilla-jsoneditor/standalone.js'

function dfs_visit_block(block_name, visited_blocks, steps_to_plot, data) {
    if (block_name in visited_blocks) return;
    visited_blocks[block_name] = true;

    let block_data = data["instructions"][block_name];
    let steps = block_data.steps;
    let range = 1;
    let counter = 0;
    if (!(block_name in steps_to_plot)) {
        steps_to_plot[block_name] = {"counter": 0, "reps": 1, "steps": []};
    }

    for (let i=0; i < steps.length; i++) {
        let step = steps[i];
        if (typeof step.time === 'object' && step.time.type === "equation") {
            let equation_name = step.time.equation;
            if (!(equation_name in data["equations"])) {
                console.log("Equation " + equation_name + " not found in equations.");
                return;
            }
            let equation = data["equations"][equation_name].equation;
            let equation_result = evaluate_equation(equation, {}, data["settings"]);
            if (equation_result === null) {
                console.log("Error evaluating equation: " + equation);
                return;
            }
            step.time = equation_result;
        }
        if (step.action == "run_block") {
            dfs_visit_block(step.block, visited_blocks, steps_to_plot, data);
            steps_to_plot[block_name]["steps"].push(step);
        } else if (step.action == "loop") {
            counter = step.counter;
            range = step.range;
            steps.splice(i + 1, 0, ...step.steps);
            // TODO: verify if the loop count will always be valid like this.
            if ("block" in step.steps[0]) {
                let repeating_block_name = step.steps[0].block;
                steps_to_plot[repeating_block_name] = {"counter": counter, "reps": range, "steps": []};
            }
        } else if (step.action == "rf" || step.action == "grad" || step.action == "adc" || step.action == "mark" || step.action == "submit") {
            steps_to_plot[block_name]["steps"].push(step);
        } else if (step.action == "init" || step.action == "sync" || step.action == "calc") {
            // TODO: deal with event actions
        }
    }
    steps_to_plot[block_name]["steps"].sort((a, b) => a.time - b.time);
}

function plot_sequence(data) {
    var rf_pulse_data = [];
    if ("rfpulse" in data["arrays"])  rf_pulse_data = data["arrays"]["rfpulse"]["data"];
    else rf_pulse_data = data["arrays"]["rf_pulse"]["data"];

    const rf_odd_data = [];
    const rf_even_data = [];
    for (let i=0; i < rf_pulse_data.length; i++) {
        if (i % 2 == 0) {
            rf_even_data.push(rf_pulse_data[i]);
        } else {
            rf_odd_data.push(rf_pulse_data[i]);
        }
    }

    // Storing the steps that need to be plotted
    var visited_blocks = {};
    var steps_to_plot = {};
    var instructions = JSON.parse(JSON.stringify(data["instructions"]));
    for (let block_name in instructions) {
        dfs_visit_block(block_name, visited_blocks, steps_to_plot, data);
        visited_blocks[block_name] = true;
    }

    // Step size - Siemens
    const step_size = 10;

    // storing the objects
    const objects = data["objects"];

    var rf_data = [0];
    var slice_data = [0];
    var phase_data = [0];
    var readout_data = [0];
    var adc_data = [0];

    var rf_data_x = [0];
    var slice_data_x = [0];
    var phase_data_x = [0];
    var readout_data_x = [0];
    var adc_data_x = [0];


    // Arrays to store object info for hover text
    var rf_text = [""];
    var slice_text = [""];
    var phase_text = [""];
    var readout_text = [""];
    var adc_text = [""];

    let running_time = 0;
    let rep_max = 0;
    // To be used for equation amplitude
    var counter_to_rep = {};
    let steps = [];
    if ("main" in steps_to_plot) {
        steps = steps_to_plot["main"]["steps"];
    } else if ("Main" in steps_to_plot) {
        steps = steps_to_plot["Main"];
    }

    while (steps.length > 0) {
        let item = steps.shift();
        if (item["action"] == "run_block") {
            let block_name = item["block"];
            if (block_name in steps_to_plot) {
                let counter = steps_to_plot[block_name]["counter"];
                let reps = steps_to_plot[block_name]["reps"];
                let block_steps = steps_to_plot[block_name]["steps"];
                counter_to_rep[counter] = reps;
                for (let rep=0; rep<reps; rep++) {
                    let block_steps_copy = JSON.parse(JSON.stringify(block_steps));
                    block_steps_copy[block_steps_copy.length - 1]["counter"] = counter;
                    steps.splice(0, 0, ...block_steps_copy);
                }
            }
        }
        else if (item["action"] == "rf") {
            let object_name = item["object"];
            let flip_angle = parseFloat(data["objects"][object_name]["flipangle"]);
            let start = item["time"]/step_size;
            let object = item["object"];
            for (let i=0; i<rf_even_data.length; i++) {
                rf_data.push(rf_even_data[i] * flip_angle);
                rf_text.push(object);
                rf_data_x.push(start + running_time);
                start += 2;
            }
            rep_max =  Math.max(rep_max, start - 2);
        } else if(item["axis"] == "slice" || item["axis"] == "phase" || item["axis"] == "read") {
            let start = item["time"]/step_size;
            let object = item["object"];
            let amplitude = parseFloat(data["objects"][object]["amplitude"]);

            // Updating the amplitude if available in the step.
            if ("amplitude" in item) {
                if (item["amplitude"] === "flip") {
                    amplitude = amplitude * -1;
                }
                else if ("equation" in item["amplitude"]) {
                    var equation_name = item["amplitude"]["equation"]
                    var equation = data["equations"][equation_name]["equation"];
                    amplitude = evaluate_equation(equation, counter_to_rep, data["settings"]);
                    data["objects"][object]["amplitude"] = amplitude;
                }
            }

            let array_name = data["objects"][object]["array"];
            let array_data = data["arrays"][array_name]["data"].map(function(x) { return x * amplitude});

            for (let i=0; i<array_data.length; i++) {
                if (item["axis"] == "slice") {
                    slice_data.push(array_data[i]);
                    slice_text.push(object);
                    slice_data_x.push(start + running_time);
                } else if (item["axis"] == "phase") {
                    phase_data.push(array_data[i]);
                    phase_text.push(object);
                    phase_data_x.push(start + running_time);
                } else if (item["axis"] == "read") {
                    readout_data.push(array_data[i]);
                    readout_text.push(object);
                    readout_data_x.push(start + running_time);
                }
                start++;
            }
            rep_max = Math.max(rep_max, start - 1);
        } else if (item["action"] == "adc") {
            let start = item["time"]/step_size;
            let object = item["object"];
            let duration = data["objects"][object]["duration"]/step_size;

            adc_data.push(0);
            adc_text.push(0);
            adc_data_x.push(start + running_time - 1);
            for (let i=0; i<duration; i++) {
                adc_data.push(1);
                adc_text.push(object);
                adc_data_x.push(start + running_time);
                start += 1;
            }
            adc_data.push(0);
            adc_text.push(0);
            adc_data_x.push(start + running_time);
            rep_max = Math.max(rep_max, start);
        } else if (item["action"] == "mark") {
            rep_max = Math.max(rep_max, item["time"]/step_size);
        } else if (item["action"] == "submit") {
            running_time += rep_max;
            rep_max = 0;
            let counter = item["counter"];
            if (counter > 0) {
                counter_to_rep[counter] -= 1;
            }
        }
    }

    // remove the (0,0) point if there is no data for the line and add (block_offset_time,0) point if there is.
    if (rf_data.length == 1) {
        rf_data.shift();
        rf_data_x.shift();
        rf_text.shift();
    } else {
        rf_data.push(0);
        rf_data_x.push(running_time);
        rf_text.push("");
    }
    if (slice_data.length == 1) {
        slice_data.shift();
        slice_data_x.shift();
        slice_text.shift();
    } else {
        slice_data.push(0);
        slice_data_x.push(running_time);
        slice_text.push("");
    }
    if (phase_data.length == 1) {
        phase_data.shift();
        phase_data_x.shift();
        phase_text.shift();
    } else {
        phase_data.push(0);
        phase_data_x.push(running_time);
        phase_text.push("");
    }
    if (readout_data.length == 1) {
        readout_data.shift();
        readout_data_x.shift();
        readout_text.shift();
    } else {
        readout_data.push(0);
        readout_data_x.push(running_time);
        readout_text.push("");
    }
    if (adc_data.length == 1) {
        adc_data.shift();
        adc_data_x.shift();
        adc_text.shift();
    } else {
        adc_data.push(0);
        adc_data_x.push(running_time);
        adc_text.push("");
    }

    // divide all the x data by 100 to get the time in ms
    rf_data_x = rf_data_x.map(x => x/100);
    slice_data_x = slice_data_x.map(x => x/100);
    phase_data_x = phase_data_x.map(x => x/100);
    readout_data_x = readout_data_x.map(x => x/100);
    adc_data_x = adc_data_x.map(x => x/100);

    const plot_rf_data = {
        x: rf_data_x,
        y: rf_data,
        xaxis: 'x1',
        yaxis: 'y1',
        type: 'scatter',
        name: 'RF pulse',
        text: rf_text,
        hovertemplate: '<b> %{text}</b><br> %{y:.2f}<extra></extra>'
    };

    const plot_slice_data = {
        x: slice_data_x,
        y: slice_data,
        xaxis: 'x2',
        yaxis: 'y2',
        type: 'scatter',
        name: 'slice',
        text: slice_text,
        hovertemplate: '<b> %{text}</b><br> %{y:.2f}<extra></extra>'
    };

    const plot_phase_data = {
        x: phase_data_x,
        y: phase_data,
        xaxis: 'x3',
        yaxis: 'y3',
        type: 'scatter',
        name: 'phase',
        text: phase_text,
        hovertemplate: '<b> %{text}</b><br> %{y:.2f}<extra></extra>'
    };

    const plot_readout_data = {
        x: readout_data_x,
        y: readout_data,
        xaxis: 'x4',
        yaxis: 'y4',
        type: 'scatter',
        name: 'readout',
        text: readout_text,
        hovertemplate: '<b> %{text}</b><br> %{y:.2f}<extra></extra>'
    };

    const plot_adc_data = {
        x: adc_data_x,
        y: adc_data,
        xaxis: 'x5',
        yaxis: 'y5',
        type: 'scatter',
        name: 'ADC',
        text: adc_text,
        hovertemplate: '<b> %{text}</b><br> %{y:.2f}<extra></extra>'
    };

    var stacked_plots = [plot_rf_data, plot_slice_data, plot_phase_data, plot_readout_data, plot_adc_data];

    var layout = {
        grid: {
            rows: 5,
            columns: 1,
            pattern: 'independent'
        },
        margin: {
            t: 20,
            b: 40,
            // r: 15,
            // l: 60
        },
        plot_bgcolor:"rgba(0,0,0,0.1)",
        paper_bgcolor:"rgba(0,0,0,0.6)",
        height: window.innerHeight,
        showlegend: false,
        xaxis1: {
            tickformat: "~",
            "showticklabels": true,
            "matches": "x5",
            tickfont : {
            color : 'rgba(255,255,255,0.9)',
            gridcolor: 'red'
            },
            "gridcolor": "rgba(255,255,255,0.05)",
            "zerolinecolor": "rgba(255,255,255,0.2)",
        },
        xaxis2: {
            tickformat: "~",
            "showticklabels": true,
            "matches": "x5",
            tickfont : {
            color : 'rgba(255,255,255,0.9)'
            },
            "gridcolor": "rgba(255,255,255,0.05)",
            "zerolinecolor": "rgba(255,255,255,0.2)",
        },
        xaxis3: {
            tickformat: "~",
            "showticklabels": true,
            "matches": "x5",
            tickfont : {
            color : 'rgba(255,255,255,0.9)'
            },
            "gridcolor": "rgba(255,255,255,0.05)",
            "zerolinecolor": "rgba(255,255,255,0.2)",
        },
        xaxis4: {
            tickformat: "~",
            "showticklabels": true,
            "matches": "x5",
            tickfont : {
            color : 'rgba(255,255,255,0.9)'
            },
            "gridcolor": "rgba(255,255,255,0.05)",
            "zerolinecolor": "rgba(255,255,255,0.2)",
        },
        xaxis5: {
            title: {
                text: "time (ms)",
                font: {
                    family: 'Arial, sans-serif',
                    size: 12,
                    color: 'rgba(255,255,255,0.9)'
                }
            },
            tickformat: "~",
            tickfont : {
            color : 'rgba(255,255,255,0.9)'
            },
            "gridcolor": "rgba(255,255,255,0.05)",
            "zerolinecolor": "rgba(255,255,255,0.2)",
        },
        yaxis1: {
            title: {
                text: "RF (FA)",
                font: {
                    family: 'Arial, sans-serif',
                    size: 12,
                    color: 'rgba(255,255,255,0.9)'
                }
            },
            tickfont : {
            color : 'rgba(255,255,255,0.9)'
            },
            "gridcolor": "rgba(255,255,255,0.05)",
            "zerolinecolor": "rgba(255,255,255,0.2)",
            fixedrange: true,
        },
        yaxis2: {
            title: {
                text: "Slice (mT/m)",
                font: {
                    family: 'Arial, sans-serif',
                    size: 12,
                    color: 'rgba(255,255,255,0.9)'
                }
            },
            tickfont : {
            color : 'rgba(255,255,255,0.9)'
            },
            "gridcolor": "rgba(255,255,255,0.05)",
            "zerolinecolor": "rgba(255,255,255,0.2)",
            fixedrange: true,
        },
        yaxis3: {
            title: {
                text: "Phase (mT/m)",
                font: {
                    family: 'Arial, sans-serif',
                    size: 12,
                    color: 'rgba(255,255,255,0.9)'
                }
            },
            tickfont : {
            color : 'rgba(255,255,255,0.9)'
            },
            "gridcolor": "rgba(255,255,255,0.05)",
            "zerolinecolor": "rgba(255,255,255,0.2)",
            fixedrange: true,
        },
        yaxis4: {
            title: {
                text: "Readout (mT/m)",
                font: {
                    family: 'Arial, sans-serif',
                    size: 12,
                    color: 'rgba(255,255,255,0.9)'
                }
            },
            tickfont : {
            color : 'rgba(255,255,255,0.9)'
            },
            "gridcolor": "rgba(255,255,255,0.05)",
            "zerolinecolor": "rgba(255,255,255,0.2)",
            fixedrange: true,
        },
        yaxis5: {
            title: {
                text: "ADC (on/off)",
                font: {
                    family: 'Arial, sans-serif',
                    size: 12,
                    color: 'rgba(255,255,255,0.9)'
                }
            },
            tickfont : {
            color : 'rgba(255,255,255,0.9)'
            },
            "gridcolor": "rgba(255,255,255,0.05)",
            "zerolinecolor": "rgba(255,255,255,0.2)",
            fixedrange: true,
        },
        hovermode: "x",
    };

    const config = {
        scrollZoom: true,
        responsive: true,
        displaylogo: false,
    }

    Plotly.newPlot('chart1', stacked_plots, layout, config);
    const myPlot = document.getElementById('chart1');

    // If the size of window is changed, we update the layout!
    window.onresize = function() {
        var update = {
            "height": window.innerHeight,
            "width": $("#chart1").width(),
        }
        Plotly.relayout(myPlot, update);
    };

    // If more zoomed out than the initial zoom- reset it.
    myPlot.on('plotly_relayout',(e)=>{
        var zoom_level = e['xaxis.range[0]'];
        if (zoom_level < 0){
            var update = {
                'xaxis.autorange': true,
            };
            Plotly.relayout(myPlot, update);
        }
    })

    // If shift is pressed, we will show detailed object information.
    const default_hover_template = '<b> %{text}</b><br> %{y:.2f}<extra></extra>';
    myPlot.on('plotly_hover', function(data){
        if (shiftIsPressed) {
            let object_name = data.points[0].text;

            let object_data = objects[object_name];
            let object_data_string = "";
            for (const property in object_data) {
                object_data_string += `${property}: ${object_data[property]} <br>`;
              }
            let shift_hover_template = '<b>' + object_name + '</b><br><br><extra></extra>' +
                                        object_data_string;
            let update = {
                hovertemplate: shift_hover_template
            }
            Plotly.restyle(myPlot, update, [0,1,2,3,4])
        }
    })
     .on('plotly_unhover', function(){
        var update = {
            hovertemplate: default_hover_template
        }
        Plotly.restyle(myPlot, update, [0,1,2,3,4])
    });
}

function evaluate_equation(equation, counter_to_rep, settings) {
    // To replace ctr(1) with the current rep value.
    function ctr(counter_number) {
        return counter_to_rep[counter_number];
    }

    // To replace set(parameter) with parameter value from settings.
    function set(parameter) {
        if (parameter in settings) {
            return settings[parameter];
        } else {
            console.log("Parameter " + parameter + " not found in settings.");
        }
    }

     // To add quotation marks around the parameter names in the equation.
     equation = equation.replace(/set\((\w+)\)/g, "set('$1')");

    // If existing, it will replace the substring.
    // We can add support for more functions accordingly.
    var newEquation = equation.replace("sin", "Math.sin");
    newEquation = newEquation.replace("cos", "Math.cos");
    newEquation = newEquation.replace("tan", "Math.tan");
    newEquation = newEquation.replace("cot", "Math.cot");
    newEquation = newEquation.replace("sec", "Math.sec");
    newEquation = newEquation.replace("csc", "Math.csc");
    newEquation = newEquation.replace("exp", "Math.exp");

    var val = eval(newEquation);

    return val;
}

var json_editor = null;

$(document).ready(function() {
    plot_sequence(JSON.parse(JSON.stringify(data)));

    // give the effect of empty plot on load
    let plot = document.getElementById('chart1');
    let layout = plot.layout;
    let empty_data = JSON.parse(JSON.stringify(plot.data));
    for (let i = 0; i < empty_data.length; i++) {
        empty_data[i].x = [];
        empty_data[i].y = [];
    }
    Plotly.react(plot, empty_data, layout);

    let content = {
        text: undefined,
        json: {}
    }
    json_editor = createJSONEditor({
        target: document.getElementById('jsonviewer'),
        props: {
            content,
            mainMenuBar: false,
            navigationBar: false,
            statusBar: false,
            readOnly: true,
        }
    });

    const fileInput = document.getElementById('formFile');
    fileInput.oninput = () => {
        const selectedFile = fileInput.files[0];
        var reader = new FileReader();
        reader.readAsText(selectedFile, "UTF-8");
        reader.onload = function(e) {
            let newData = JSON.parse(reader.result);
            if (load_sdl_file(newData)) {
                json_editor.set({text: undefined, json: newData});
                $("#fileViewerFileName").text("- " + selectedFile.name);
            }
        };
    }

    $("#view-file-btn").click(function () {
        json_editor.expand([], relativePath => relativePath.length < 2);
        $('#fileViewerModal').modal('toggle');
    });

    $('#flexSwitchCheckChecked').click(function(){
        let current_theme = document.documentElement.getAttribute('data-bs-theme');
        if (current_theme == "light") {
            update_theme("dark");
        } else {
            update_theme("light");
        }
    });
});

// Check whether shift button is pressed
$(document).keydown(function(event) {
    if (event.which == "16") {
        shiftIsPressed = true;
    }
});
$(document).keyup(function() {
    shiftIsPressed = false;
});
var shiftIsPressed = false;

var popover = new bootstrap.Popover(document.querySelector('.shortcuts-popover'), {
    container: 'body',
    html: true,
    content: $('[data-name="popover-content"]')
});

function update_theme(toTheme) {
    if (toTheme == "light") {
        document.documentElement.setAttribute('data-bs-theme','light');
        $('input[type="checkbox"]').attr("checked", false);
        $(".btn-secondary").each(function(){
            $(this).removeClass("btn-secondary");
            $(this).addClass("btn-light");
        });
        $("body").css('background', "#f8fafc");
        toggle_plot_color(true);
        $("#plot-col").css({'background': "#ffffff", 'border-left': "1px solid #dfe2e6", 'border-right': "1px solid #dfe2e6"});
        $("#mtrk-logo").hide();
        $("#mtrk-logo-dark").show();
        $("#mtrk-logo").removeClass("d-inline-block");
        $("#mtrk-logo-dark").addClass("d-inline-block");
    }
    else {
        document.documentElement.setAttribute('data-bs-theme','dark');
        $('input[type="checkbox"]').attr("checked", true);
        $(".btn-light").each(function(){
            $(this).removeClass("btn-light");
            $(this).addClass("btn-secondary");
        });
        $("body").css('background', "var(--bs-body-bg)");
        toggle_plot_color(false);
        $("#plot-col").css({'background': "var(--bs-body-bg)", "border-left": "1px solid #34373b", "border-right": "1px solid #34373b"});
        $("#mtrk-logo").show();
        $("#mtrk-logo-dark").hide();
        $("#mtrk-logo-dark").removeClass("d-inline-block");
        $("#mtrk-logo").addClass("d-inline-block");
    }
}

function toggle_plot_color(isDark) {
    if (isDark) {
        var update = {
            "plot_bgcolor":"rgba(255,255,255,0.1)",
            "paper_bgcolor":"rgba(255,255,255,0.1)",
            "title.font.color": 'rgba(0,0,0,0.9)'
        }
        for (let i = 0; i <= 5; i++) {
            let xaxis_number = i;
            if (i == 0) {
                xaxis_number = "";
            }
            update[`xaxis${xaxis_number}.title.font.color`] = "rgba(0,0,0,0.9)";
            update[`xaxis${xaxis_number}.tickfont.color`] = "rgba(0,0,0,0.9)";
            update[`xaxis${xaxis_number}.gridcolor`] = "rgba(0,0,0,0.05)";
            update[`xaxis${xaxis_number}.zerolinecolor`] = "rgba(0,0,0,0.2)";
            update[`yaxis${xaxis_number}.title.font.color`] = "rgba(0,0,0,0.9)";
            update[`yaxis${xaxis_number}.tickfont.color`] = "rgba(0,0,0,0.9)";
            update[`yaxis${xaxis_number}.gridcolor`] = "rgba(0,0,0,0.05)";
            update[`yaxis${xaxis_number}.zerolinecolor`] = "rgba(0,0,0,0.2)";
        }
    } else {
        var update = {
            "plot_bgcolor":"rgba(0,0,0,0.1)",
            "paper_bgcolor":"rgba(0,0,0,0.6)",
            "title.font.color": 'rgba(255,255,255,0.9)'
        }
        for (let i = 0; i <= 5; i++) {
            let xaxis_number = i;
            if (i == 0) {
                xaxis_number = "";
            }
            update[`xaxis${xaxis_number}.title.font.color`] = "rgba(255,255,255,0.9)";
            update[`xaxis${xaxis_number}.tickfont.color`] = "rgba(255,255,255,0.9)";
            update[`xaxis${xaxis_number}.gridcolor`] = "rgba(255,255,255,0.05)";
            update[`xaxis${xaxis_number}.zerolinecolor`] = "rgba(255,255,255,0.2)";
            update[`yaxis${xaxis_number}.title.font.color`] = "rgba(255,255,255,0.9)";
            update[`yaxis${xaxis_number}.tickfont.color`] = "rgba(255,255,255,0.9)";
            update[`yaxis${xaxis_number}.gridcolor`] = "rgba(255,255,255,0.05)";
            update[`yaxis${xaxis_number}.zerolinecolor`] = "rgba(255,255,255,0.2)";
        }
    }
    Plotly.relayout("chart1", update);
}

function load_sdl_file(sdl_data) {
    $("#alert").hide();
    $("#dummy-file-alert").hide();
    $("#output-sdl-alert").hide();
    try {
        plot_sequence(sdl_data);
        if (document.documentElement.getAttribute('data-bs-theme') == 'dark') {
            toggle_plot_color(false);
        }
        else {
            toggle_plot_color(true);
        }
    } catch (e) {
        console.log(e);
        $("#alert").show();
        return false;
    }
    return true;
}

window.addEventListener('load', function() {
    var loader = document.getElementById('loader');
    loader.style.opacity = '0'; // Fade out loader
    setTimeout(function() {
        loader.style.display = 'none'; // Hide loader
    }, 500); // Wait for fade-out effect to complete
});

// var designer_url = 'http://127.0.0.1:5010';
window.addEventListener('message', (event) => {
    if (event.origin.startsWith('http://127.0.0.1')) {
        let received_sdl = JSON.parse(event.data);
        if (load_sdl_file(received_sdl)) {
            $("#output-sdl-alert").show();
            json_editor.set({text: undefined, json: received_sdl});
            $("#fileViewerFileName").text("- " + "output_sdl_file.mtrk");
        }
    }
});